/**
 * OAuth 2.1 authorization server for the MCP endpoint (stateless — all
 * codes/tokens are HMAC-signed payloads, no storage).
 *
 * Flow (MCP auth spec):
 *   client → /.well-known/oauth-protected-resource → authorization server
 *   client → POST /register (RFC 7591 DCR; client_id = signed redirect_uris)
 *   client → GET /authorize → 302 GitHub OAuth (scope read:user)
 *   GitHub → GET /callback → collaborator check → 302 client redirect + code
 *   client → POST /token (PKCE S256) → access_token (30 days, signed)
 *
 * Authorization = being a collaborator on the GitHub repo (same as CMS).
 */
import { sign, verify, s256 } from './lib/crypto.js';
import { isCollaborator } from './github.js';

const CODE_TTL_S = 300; // 5 min
const STATE_TTL_S = 600; // 10 min
const ACCESS_TTL_S = 30 * 24 * 3600; // 30 days

export const jsonRes = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });

const htmlRes = (text, status = 200) =>
  new Response(
    `<!doctype html><html lang="no"><meta charset="utf-8"><title>puck.no admin</title>` +
      `<body style="font-family:sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem">${text}</body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  );

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
    body = await request.json();
  } catch {
    return jsonRes({ error: 'invalid_client_metadata' }, 400);
  }
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u) => typeof u === 'string') : [];
  if (uris.length === 0) return jsonRes({ error: 'invalid_redirect_uri' }, 400);
  const clientId = await sign({ uris, typ: 'client' }, env.MCP_TOKEN_SECRET);
  return jsonRes(
    {
      client_id: clientId,
      client_name: body.client_name ?? 'mcp-client',
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
  if (!codeChallenge || method !== 'S256') return err('PKCE (S256) er påkrevd.');
  const client = await verify(clientId, env.MCP_TOKEN_SECRET);
  if (!client || client.typ !== 'client') return err('Ukjent client_id — registrer klienten først (/register).');
  if (!client.uris.includes(redirectUri)) return err('redirect_uri samsvarer ikke med registreringen.');

  const ghState = await sign(
    { ru: redirectUri, st: state, cc: codeChallenge, exp: Math.floor(Date.now() / 1000) + STATE_TTL_S },
    env.MCP_TOKEN_SECRET,
  );
  const base = baseUrl(request);
  const gh = new URL('https://github.com/login/oauth/authorize');
  gh.searchParams.set('client_id', env.GITHUB_OAUTH_CLIENT_ID);
  gh.searchParams.set('redirect_uri', `${base}/callback`);
  gh.searchParams.set('state', ghState);
  gh.searchParams.set('scope', 'read:user');
  return Response.redirect(gh.toString(), 302);
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

  const ourCode = await sign(
    { sub: login, cc: st.cc, ru: st.ru, typ: 'code', exp: Math.floor(Date.now() / 1000) + CODE_TTL_S },
    env.MCP_TOKEN_SECRET,
  );
  const back = new URL(st.ru);
  back.searchParams.set('code', ourCode);
  back.searchParams.set('state', st.st);
  return Response.redirect(back.toString(), 302);
}

/** POST /token — verify code + PKCE, issue the access token. */
export async function token(request, env) {
  let form;
  try {
    form = new URLSearchParams(await request.text());
  } catch {
    return jsonRes({ error: 'invalid_request' }, 400);
  }
  if (form.get('grant_type') !== 'authorization_code') {
    return jsonRes({ error: 'unsupported_grant_type' }, 400);
  }
  const code = await verify(form.get('code') ?? '', env.MCP_TOKEN_SECRET);
  if (!code || code.typ !== 'code') return jsonRes({ error: 'invalid_grant' }, 400);
  const verifier = form.get('code_verifier') ?? '';
  if (!verifier || (await s256(verifier)) !== code.cc) {
    return jsonRes({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);
  }
  const redirectUri = form.get('redirect_uri');
  if (redirectUri && redirectUri !== code.ru) {
    return jsonRes({ error: 'invalid_grant', error_description: 'redirect_uri mismatch' }, 400);
  }

  const accessToken = await sign(
    { sub: code.sub, scope: 'admin', typ: 'access', exp: Math.floor(Date.now() / 1000) + ACCESS_TTL_S },
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
  return { login: payload.sub };
}
