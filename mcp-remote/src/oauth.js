/**
 * OAuth 2.1 authorization server for the MCP endpoint. State and tokens are
 * HMAC-signed; authorization-code identifiers are persisted in D1 so each
 * short-lived code can be consumed only once.
 *
 * Flow (MCP auth spec):
 *   client → /.well-known/oauth-protected-resource → authorization server
 *   client → POST /register (RFC 7591 DCR; client_id = signed redirect_uris)
 *   client → GET /authorize → 302 GitHub OAuth (scope read:user)
 *   GitHub → GET /callback → collaborator check → explicit callback consent
 *   user → POST /approve → one-use authorization code
 *   client → POST /token (PKCE S256) → access_token (1 hour, signed)
 *
 * Authorization = being a collaborator on the GitHub repo (same as CMS).
 */
import { sign, verify, s256 } from './lib/crypto.js';
import { readTextLimited, RequestTooLargeError } from './lib/request.js';
import { isCollaborator } from './github.js';

const CODE_TTL_S = 300; // 5 min
const STATE_TTL_S = 600; // 10 min
const ACCESS_TTL_S = 60 * 60; // 1 hour; authorization is rechecked per request

export const jsonRes = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      ...headers,
    },
  });

const htmlRes = (text, status = 200) =>
  new Response(
    `<!doctype html><html lang="no"><meta charset="utf-8"><title>puck.no admin</title>` +
      `<body style="font-family:sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem">${text}</body></html>`,
    {
      status,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
        'Referrer-Policy': 'no-referrer',
        'X-Frame-Options': 'DENY',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );

const redirectRes = (location, status = 302) => new Response(null, {
  status,
  headers: {
    Location: location,
    'Cache-Control': 'no-store',
    Pragma: 'no-cache',
    'Referrer-Policy': 'no-referrer',
  },
});

const escapeHtml = (value) => String(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

/** OAuth 2.1 redirect policy: claimed HTTPS URLs, plus native loopback HTTP. */
export function validRedirectUri(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2048) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  const loopback = url.hostname === '127.0.0.1' || url.hostname === '[::1]' || url.hostname === 'localhost';
  return url.protocol === 'http:' && loopback;
}

export function baseUrl(request) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

/** RFC 9728 — tells the MCP client where to authenticate. */
export function protectedResource(request) {
  const base = baseUrl(request);
  return jsonRes({
    resource: `${base}/mcp`,
    authorization_servers: [base],
    bearer_methods_supported: ['header'],
  });
}

/** RFC 8414 — authorization server metadata. */
export function authorizationServerMetadata(request) {
  const base = baseUrl(request);
  return jsonRes({
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    registration_endpoint: `${base}/register`,
    grant_types_supported: ['authorization_code'],
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none'],
  });
}

/** RFC 7591 dynamic client registration (public clients, PKCE-only). */
export async function register(request, env) {
  let body;
  try {
    body = JSON.parse(await readTextLimited(request, 16 * 1024));
  } catch (error) {
    if (error instanceof RequestTooLargeError) return jsonRes({ error: 'invalid_client_metadata' }, 413);
    return jsonRes({ error: 'invalid_client_metadata' }, 400);
  }
  const uris = Array.isArray(body.redirect_uris) ? [...new Set(body.redirect_uris)] : [];
  if (uris.length === 0 || uris.length > 5 || !uris.every(validRedirectUri)) {
    return jsonRes({ error: 'invalid_redirect_uri' }, 400);
  }
  const name = typeof body.client_name === 'string' && body.client_name.trim()
    ? body.client_name.trim().slice(0, 100)
    : 'MCP client';
  const clientId = await sign({ uris, name, typ: 'client' }, env.MCP_TOKEN_SECRET);
  return jsonRes(
    {
      client_id: clientId,
      client_name: name,
      redirect_uris: uris,
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    },
    201,
  );
}

/** GET /authorize — validate the MCP client request, bounce to GitHub. */
export async function authorize(request, env) {
  const q = new URL(request.url).searchParams;
  const clientId = q.get('client_id') ?? '';
  const redirectUri = q.get('redirect_uri') ?? '';
  const state = q.get('state') ?? '';
  const codeChallenge = q.get('code_challenge') ?? '';
  const method = q.get('code_challenge_method') ?? '';
  const err = (msg) => htmlRes(`<h1>Ugyldig forespørsel</h1><p>${msg}</p>`, 400);

  if (q.get('response_type') !== 'code') return err('response_type må være «code».');
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(codeChallenge) || method !== 'S256') {
    return err('Gyldig PKCE (S256) er påkrevd.');
  }
  if (clientId.length > 16_384 || redirectUri.length > 2_048 || state.length > 2_048) {
    return err('Forespørselen er for stor.');
  }
  const client = await verify(clientId, env.MCP_TOKEN_SECRET);
  if (!client || client.typ !== 'client') return err('Ukjent client_id — registrer klienten først (/register).');
  if (!client.uris.includes(redirectUri)) return err('redirect_uri samsvarer ikke med registreringen.');

  const ghState = await sign(
    {
      ru: redirectUri,
      st: state,
      cc: codeChallenge,
      cid: clientId,
      cn: client.name ?? 'MCP client',
      exp: Math.floor(Date.now() / 1000) + STATE_TTL_S,
    },
    env.MCP_TOKEN_SECRET,
  );
  const base = baseUrl(request);
  const gh = new URL('https://github.com/login/oauth/authorize');
  gh.searchParams.set('client_id', env.GITHUB_OAUTH_CLIENT_ID);
  gh.searchParams.set('redirect_uri', `${base}/callback`);
  gh.searchParams.set('state', ghState);
  gh.searchParams.set('scope', 'read:user');
  return redirectRes(gh.toString(), 302);
}

/** GET /callback — GitHub identity → collaborator check → issue our code. */
export async function callback(request, env) {
  const q = new URL(request.url).searchParams;
  const ghState = q.get('state') ?? '';
  const code = q.get('code') ?? '';
  const st = await verify(ghState, env.MCP_TOKEN_SECRET);
  if (!st) return htmlRes('<h1>Ugyldig eller utløpt state</h1><p>Prøv å logge inn på nytt.</p>', 400);
  if (!code) return htmlRes('<h1>Ingen kode fra GitHub</h1><p>Innloggingen ble avbrutt.</p>', 400);

  // Exchange the GitHub code for a user token and read the identity.
  const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: env.GITHUB_OAUTH_CLIENT_ID,
      client_secret: env.GITHUB_OAUTH_CLIENT_SECRET,
      code,
      redirect_uri: `${baseUrl(request)}/callback`,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) {
    return htmlRes('<h1>GitHub-innlogging feilet</h1><p>Kunne ikke veksle inn koden.</p>', 502);
  }
  const userRes = await fetch('https://api.github.com/user', {
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Bearer ${tokenData.access_token}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'puck-no-mcp-remote',
    },
  });
  if (!userRes.ok) return htmlRes('<h1>GitHub-innlogging feilet</h1><p>Kunne ikke hente brukeren.</p>', 502);
  const login = (await userRes.json()).login;

  if (!(await isCollaborator(env, login))) {
    return htmlRes(
      `<h1>Ikke tilgang</h1><p>«${login}» er ikke collaborator på puck.no-repoet. ` +
        'Be en administrator om tilgang (GitHub → repo → Settings → Collaborators).</p>',
      403,
    );
  }

  const consent = await sign(
    {
      sub: login,
      cc: st.cc,
      ru: st.ru,
      st: st.st,
      cid: st.cid,
      cn: st.cn,
      typ: 'consent',
      exp: Math.floor(Date.now() / 1000) + CODE_TTL_S,
    },
    env.MCP_TOKEN_SECRET,
  );
  const callback = new URL(st.ru);
  return htmlRes(
    `<h1>Gi administratortilgang?</h1>` +
      `<p><strong>${escapeHtml(st.cn ?? 'MCP client')}</strong> ber om full administratortilgang til puck.no som ` +
      `<strong>${escapeHtml(login)}</strong>.</p>` +
      `<p>Etter godkjenning sendes en engangskode til <code>${escapeHtml(callback.origin)}</code>. ` +
      `Godkjenn bare hvis du startet innloggingen og kjenner denne adressen.</p>` +
      `<form method="post" action="/approve">` +
      `<input type="hidden" name="consent" value="${escapeHtml(consent)}">` +
      `<button name="decision" value="allow" type="submit">Godkjenn</button> ` +
      `<button name="decision" value="deny" type="submit">Avbryt</button>` +
      `</form>`,
  );
}

/** POST /approve — explicit user consent, then persist a one-use code id. */
export async function approve(request, env) {
  if (!(request.headers.get('Content-Type') ?? '').toLowerCase().startsWith('application/x-www-form-urlencoded')) {
    return jsonRes({ error: 'invalid_request' }, 415);
  }
  let form;
  try {
    form = new URLSearchParams(await readTextLimited(request, 32 * 1024));
  } catch (error) {
    return jsonRes({ error: 'invalid_request' }, error instanceof RequestTooLargeError ? 413 : 400);
  }
  const pending = await verify(form.get('consent') ?? '', env.MCP_TOKEN_SECRET);
  if (!pending || pending.typ !== 'consent' || !validRedirectUri(pending.ru)) {
    return htmlRes('<h1>Ugyldig eller utløpt godkjenning</h1><p>Start innloggingen på nytt.</p>', 400);
  }
  const back = new URL(pending.ru);
  if (form.get('decision') !== 'allow') {
    back.searchParams.set('error', 'access_denied');
    back.searchParams.set('state', pending.st ?? '');
    return redirectRes(back.toString(), 303);
  }

  const jti = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + CODE_TTL_S;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM oauth_codes WHERE expires_at < ?').bind(Math.floor(Date.now() / 1000)),
    env.DB.prepare('INSERT INTO oauth_codes (jti, expires_at) VALUES (?, ?)').bind(jti, expiresAt),
  ]);
  const ourCode = await sign(
    {
      sub: pending.sub,
      cc: pending.cc,
      ru: pending.ru,
      cid: pending.cid,
      jti,
      typ: 'code',
      exp: expiresAt,
    },
    env.MCP_TOKEN_SECRET,
  );
  back.searchParams.set('code', ourCode);
  back.searchParams.set('state', pending.st ?? '');
  return redirectRes(back.toString(), 303);
}

/** POST /token — verify code + PKCE, issue the access token. */
export async function token(request, env) {
  if (!(request.headers.get('Content-Type') ?? '').toLowerCase().startsWith('application/x-www-form-urlencoded')) {
    return jsonRes({ error: 'invalid_request' }, 415);
  }
  let form;
  try {
    const raw = await readTextLimited(request, 32 * 1024);
    form = new URLSearchParams(raw);
  } catch (error) {
    return jsonRes({ error: 'invalid_request' }, error instanceof RequestTooLargeError ? 413 : 400);
  }
  if (form.get('grant_type') !== 'authorization_code') {
    return jsonRes({ error: 'unsupported_grant_type' }, 400);
  }
  const code = await verify(form.get('code') ?? '', env.MCP_TOKEN_SECRET);
  if (!code || code.typ !== 'code' || !code.jti || !code.cid) return jsonRes({ error: 'invalid_grant' }, 400);
  if (form.get('client_id') !== code.cid) {
    return jsonRes({ error: 'invalid_grant', error_description: 'client_id mismatch' }, 400);
  }
  const verifier = form.get('code_verifier') ?? '';
  if (!verifier || (await s256(verifier)) !== code.cc) {
    return jsonRes({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);
  }
  const redirectUri = form.get('redirect_uri');
  if (redirectUri && redirectUri !== code.ru) {
    return jsonRes({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }, 400);
  }

  // Authorization codes are one-use. Consume only after every client/PKCE
  // check so a bad request cannot burn a legitimate user's code.
  const consumed = await env.DB.prepare(
    'DELETE FROM oauth_codes WHERE jti = ? AND expires_at >= ?',
  ).bind(code.jti, Math.floor(Date.now() / 1000)).run();
  if (consumed.meta?.changes !== 1) return jsonRes({ error: 'invalid_grant' }, 400);

  const accessToken = await sign(
    {
      sub: code.sub,
      scope: 'admin',
      typ: 'access',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + ACCESS_TTL_S,
    },
    env.MCP_TOKEN_SECRET,
  );
  return jsonRes({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ACCESS_TTL_S,
  });
}

/**
 * Bearer auth for /mcp → { login } or null.
 * When missing/invalid, caller responds 401 with WWW-Authenticate (MCP spec).
 */
export async function authenticate(request, env) {
  const m = (request.headers.get('Authorization') ?? '').match(/^Bearer (.+)$/i);
  if (!m) return null;
  const payload = await verify(m[1], env.MCP_TOKEN_SECRET);
  if (!payload || payload.typ !== 'access' || !payload.sub) return null;
  // A removed collaborator loses access immediately instead of retaining a
  // long-lived bearer token. Fail closed if GitHub cannot verify membership.
  try {
    if (!(await isCollaborator(env, payload.sub))) return null;
  } catch {
    return null;
  }
  return { login: payload.sub };
}
