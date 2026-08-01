/** Unit tests for the remote worker — pure logic + mocked env/fetch/DB. */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { b64url, b64urlDecode, sign, verify, s256 } from '../src/lib/crypto.js';
import { parseMdText, patchMdText, createMdText } from '../src/lib/frontmatter.js';
import { canonicalNameKey, parseRanking } from '../src/lib/ranking.js';
import {
  assertRankingLevel, assertTournamentRankingLevel, RANKING_LEVELS, ValidationError,
} from '../src/lib/validate.js';
import {
  assertMediaPathsAvailable, fetchBinary, fileNameFromUrl, hasExpectedFileSignature,
  regenerateConfigPreview, TOURNAMENT_PATCHABLE, TOURNAMENT_SYNC_TO_EN, validateDownloadUrl,
} from '../src/tools/contenttools.js';
import * as oauth from '../src/oauth.js';
import { auditSafe, handleMcp, TOOLS } from '../src/mcp.js';
import { commitFiles, getTextFile, GitHubError, withGitSnapshot } from '../src/github.js';
import { isOsloRefreshTime, refreshUpcomingRankings } from '../src/rankingSync.js';

const SECRET = 'test-secret-0123456789abcdef';
const env = { MCP_TOKEN_SECRET: SECRET, GITHUB_REPO: 'amundfylling/puck.no' };

// --- fetch mock control ---
const realFetch = globalThis.fetch;
let fetchImpl = null;
beforeEach(() => {
  globalThis.fetch = (...args) => (fetchImpl ? fetchImpl(...args) : realFetch(...args));
});
afterEach(() => {
  globalThis.fetch = realFetch;
  fetchImpl = null;
});

// ---------------- crypto ----------------

test('sign/verify round-trip', async () => {
  const token = await sign({ sub: 'amund', exp: Math.floor(Date.now() / 1000) + 60 }, SECRET);
  const payload = await verify(token, SECRET);
  assert.equal(payload.sub, 'amund');
});

test('verify rejects tampered tokens and wrong secrets', async () => {
  const token = await sign({ sub: 'amund' }, SECRET);
  const [body, sig] = token.split('.');
  assert.equal(await verify(`${body}.${sig.slice(0, -2)}xx`, SECRET), null);
  assert.equal(await verify(token, 'other-secret'), null);
  const other = await sign({ sub: 'mallory' }, 'other-secret');
  assert.equal(await verify(other, SECRET), null);
});

test('verify rejects expired tokens', async () => {
  const token = await sign({ sub: 'x', exp: Math.floor(Date.now() / 1000) - 120 }, SECRET);
  assert.equal(await verify(token, SECRET), null);
});

test('b64url round-trips unicode', () => {
  const s = 'påmelding æøå 🏒';
  assert.equal(new TextDecoder().decode(b64urlDecode(b64url(s))), s);
});

test('s256 matches the RFC 7636 test vector', async () => {
  const challenge = await s256('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
  assert.equal(challenge, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

// ---------------- frontmatter ----------------

const SAMPLE = `---
name: "Test"
slug: "test-slug"
registrationOpen: true
---

Body med **markdown**.
`;

test('patchMdText updates keys and preserves body', () => {
  const { text, before } = patchMdText(SAMPLE, { registrationOpen: false, date: '5. mai 2026' });
  assert.equal(before.registrationOpen, true);
  assert.equal(before.date, null);
  const { data, body } = parseMdText(text);
  assert.equal(data.registrationOpen, false);
  assert.equal(data.date, '5. mai 2026');
  assert.equal(body, parseMdText(SAMPLE).body);
});

test('createMdText parses back', () => {
  const text = createMdText({ title: 'Hei', slug: 'hei-du', playersPerTeam: 2, maxSubstitutes: 1, rankingLevel: '10' }, '# Tittel\n');
  const { data } = parseMdText(text);
  assert.equal(data.slug, 'hei-du');
  assert.equal(data.playersPerTeam, 2);
  assert.equal(data.rankingLevel, '10');
});

test('rankingLevel validation, MCP schemas and English sync use the exact supported values', async () => {
  assert.doesNotThrow(() => assertRankingLevel(null));
  for (const level of RANKING_LEVELS) assert.doesNotThrow(() => assertRankingLevel(level));
  assert.throws(() => assertRankingLevel('1'), ValidationError);
  assert.doesNotThrow(() => assertTournamentRankingLevel(null, '3'));
  assert.doesNotThrow(() => assertTournamentRankingLevel(2, '10'));
  assert.throws(() => assertTournamentRankingLevel(2, '3'), ValidationError);
  assert.throws(() => assertTournamentRankingLevel(null, '10'), ValidationError);
  const create = TOOLS.find((tool) => tool.name === 'create_tournament');
  const update = TOOLS.find((tool) => tool.name === 'update_tournament');
  assert.deepEqual(create.inputSchema.properties.rankingLevel.enum, [null, ...RANKING_LEVELS]);
  assert.deepEqual(update.inputSchema.properties.rankingLevel.enum, [null, ...RANKING_LEVELS]);
  await assert.rejects(
    () => create.run(env, { name: 'Cup', slug: 'cup-2027', date: '5. september 2027', playersPerTeam: 2, rankingLevel: '3' }),
    /Lagturneringer/,
  );
  await assert.rejects(
    () => create.run(env, { name: 'Solo', slug: 'solo-2027', date: '5. september 2027', rankingLevel: '10' }),
    /bare tillatt for lagturneringer/,
  );
  assert.ok(TOURNAMENT_PATCHABLE.includes('rankingLevel'));
  assert.ok(TOURNAMENT_SYNC_TO_EN.includes('rankingLevel'));
});

test('config preview preserves rankingLevel on unrelated tournament changes', async () => {
  fetchImpl = async (url) => {
    assert.match(String(url), /functions\/lib\/tournament-config\.json$/);
    return new Response(JSON.stringify({ cup: {
      date: '5. september 2027', playersPerTeam: null, maxSubstitutes: 0,
      registrationQuestions: [], rankingLevel: '3',
    } }));
  };
  const file = await regenerateConfigPreview(env, 'cup', { registrationOpen: false });
  const config = JSON.parse(file.text);
  assert.equal(config.cup.rankingLevel, '3');
  assert.equal(config.cup.registrationOpen, false);
});

// ---------------- remote files + GitHub writes ----------------

test('remote media URLs reject SSRF targets and unsafe path segments', () => {
  assert.equal(validateDownloadUrl('https://cdn.example.net/photo.jpg').hostname, 'cdn.example.net');
  for (const url of [
    'http://cdn.example.net/photo.jpg',
    'https://localhost/photo.jpg',
    'https://127.1/photo.jpg',
    'https://[::1]/photo.jpg',
    'https://10.0.0.1/photo.jpg',
    'https://cdn.example.net:8443/photo.jpg',
    'https://user:pass@cdn.example.net/photo.jpg',
  ]) {
    assert.throws(() => validateDownloadUrl(url), ValidationError, url);
  }
  assert.throws(
    () => fileNameFromUrl('https://cdn.example.net/%2e%2e%2fsecret.pdf', ['pdf']),
    ValidationError,
  );
  assert.equal(
    fileNameFromUrl('https://cdn.example.net/%C3%A5rsm%C3%B8te-2026.pdf?download=1', ['pdf']).name,
    'årsmøte-2026.pdf',
  );
});

test('remote media validates file signatures instead of trusting extensions', () => {
  const bytes = (...values) => new Uint8Array(values);
  assert.equal(hasExpectedFileSignature(bytes(0xff, 0xd8, 0xff, 0x00), 'jpg'), true);
  assert.equal(hasExpectedFileSignature(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), 'png'), true);
  assert.equal(hasExpectedFileSignature(new TextEncoder().encode('RIFF0000WEBP'), 'webp'), true);
  assert.equal(hasExpectedFileSignature(new TextEncoder().encode('0000ftypavif0000'), 'avif'), true);
  assert.equal(hasExpectedFileSignature(new TextEncoder().encode('ID3music'), 'mp3'), true);
  assert.equal(hasExpectedFileSignature(new TextEncoder().encode('%PDF-1.7'), 'pdf'), true);
  assert.equal(hasExpectedFileSignature(new TextEncoder().encode('<script>alert(1)</script>'), 'jpg'), false);
});

test('remote media validates redirects and enforces the byte limit while streaming', async () => {
  let calls = 0;
  fetchImpl = async () => {
    calls += 1;
    return new Response(null, { status: 302, headers: { Location: 'https://127.0.0.1/private.pdf' } });
  };
  await assert.rejects(
    () => fetchBinary('https://cdn.example.net/file.pdf', 'filen', 'pdf'),
    /privat nettverk/,
  );
  assert.equal(calls, 1, 'private redirect must be rejected before a second fetch');

  fetchImpl = async () => new Response(new TextEncoder().encode('%PDF-1.7'), {
    headers: { 'Content-Length': String(10 * 1024 * 1024 + 1) },
  });
  await assert.rejects(
    () => fetchBinary('https://cdn.example.net/file.pdf', 'filen', 'pdf'),
    /for stor/,
  );

  fetchImpl = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(10 * 1024 * 1024 + 1));
      controller.close();
    },
  }));
  await assert.rejects(
    () => fetchBinary('https://cdn.example.net/file.pdf', 'filen', 'pdf'),
    /for stor/,
  );
});

test('media collision checks are Unicode- and case-insensitive', async () => {
  fetchImpl = async (url) => {
    assert.match(String(url), /\/git\/trees\/base-sha\?recursive=1$/);
    return new Response(JSON.stringify({ tree: [
      { type: 'blob', path: 'media-uploads/images/Årsmøte.JPG' },
    ] }));
  };
  await assert.rejects(
    () => assertMediaPathsAvailable(
      { ...env, GITHUB_TOKEN: 'test', __gitBaseSha: 'base-sha' },
      ['media-uploads/images/årsmøte.jpg'],
    ),
    /finnes allerede/,
  );
});

test('Git writes pin reads and commit parents to one snapshot and use a non-force CAS update', async () => {
  const requests = [];
  let blobNumber = 0;
  fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    requests.push({ url, method, body });
    if (url.endsWith('/git/ref/heads/main') && method === 'GET') {
      return new Response(JSON.stringify({ object: { sha: 'base-sha' } }));
    }
    if (url.includes('raw.githubusercontent.com')) return new Response('snapshot text');
    if (url.endsWith('/git/commits/base-sha') && method === 'GET') {
      return new Response(JSON.stringify({ tree: { sha: 'base-tree' } }));
    }
    if (url.endsWith('/git/blobs') && method === 'POST') {
      blobNumber += 1;
      return new Response(JSON.stringify({ sha: `blob-${blobNumber}` }));
    }
    if (url.endsWith('/git/trees') && method === 'POST') {
      return new Response(JSON.stringify({ sha: 'next-tree' }));
    }
    if (url.endsWith('/git/commits') && method === 'POST') {
      return new Response(JSON.stringify({ sha: 'next-commit', html_url: 'https://github.example/commit' }));
    }
    if (url.endsWith('/git/refs/heads/main') && method === 'PATCH') return new Response(null, { status: 204 });
    throw new Error(`unexpected fetch: ${method} ${url}`);
  };

  const snapshot = await withGitSnapshot({ ...env, GITHUB_TOKEN: 'test' });
  assert.equal(await getTextFile(snapshot, 'src/example.md'), 'snapshot text');
  await commitFiles(snapshot, { message: 'test', files: [{ path: 'src/example.md', text: 'next' }] });

  assert.ok(requests.some((request) => request.url.includes('/base-sha/src/example.md')));
  assert.deepEqual(requests.find((request) => request.url.endsWith('/git/commits') && request.method === 'POST').body.parents, ['base-sha']);
  assert.deepEqual(requests.find((request) => request.url.endsWith('/git/refs/heads/main')).body, {
    sha: 'next-commit', force: false,
  });
});

test('Git CAS conflicts fail visibly instead of overwriting a concurrent edit', async () => {
  fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const method = init.method ?? 'GET';
    if (url.endsWith('/git/commits/base-sha')) return new Response(JSON.stringify({ tree: { sha: 'base-tree' } }));
    if (url.endsWith('/git/blobs')) return new Response(JSON.stringify({ sha: 'blob' }));
    if (url.endsWith('/git/trees')) return new Response(JSON.stringify({ sha: 'tree' }));
    if (url.endsWith('/git/commits') && method === 'POST') {
      return new Response(JSON.stringify({ sha: 'commit', html_url: 'https://github.example/commit' }));
    }
    if (url.endsWith('/git/refs/heads/main')) {
      return new Response(JSON.stringify({ message: 'Update is not a fast forward' }), { status: 422 });
    }
    throw new Error(`unexpected fetch: ${method} ${url}`);
  };
  await assert.rejects(
    () => commitFiles(
      { ...env, GITHUB_TOKEN: 'test', __gitBaseSha: 'base-sha' },
      { message: 'test', files: [{ path: 'src/example.md', text: 'next' }] },
    ),
    (error) => error instanceof GitHubError && error.status === 422,
  );
});

test('audit logging redacts sensitive values recursively', () => {
  assert.deepEqual(auditSafe({
    title: 'Safe title',
    name: 'Person Name',
    body: 'private body',
    nested: { contact: { email: 'person@example.no', phone: '123' }, answers: { food: 'allergy' } },
    roster: [{ name: 'Player', credential: 'secret' }],
    fileUrl: 'https://cdn.example.net/private.pdf',
  }), {
    title: 'Safe title',
    name: '***',
    body: '<12 chars>',
    nested: { contact: { email: '***', phone: '***' }, answers: '***' },
    roster: [{ name: '***', credential: '***' }],
    fileUrl: '<35 chars>',
  });
});

test('ITHF ranking parser keeps total points separate and rejects missing Player_Value', () => {
  const tsv = [
    'header 1',
    'header 2',
    '1\t42\tValue Player\tOslo BHK\tNOR\t123.45\t98.765',
    '2\t43\tNo Value\t\tSWE\t12\t',
  ].join('\n');
  const { byId } = parseRanking(tsv);
  assert.equal(byId.get(42).points, 123.45);
  assert.equal(byId.get(42).value, 98.765);
  assert.equal(byId.has(43), false);
});

test('unranked duplicate keys normalize Unicode, case and whitespace', () => {
  assert.equal(canonicalNameKey(' Åge\u00a0 Hansen '), canonicalNameKey('åGE Hansen'));
  assert.equal(canonicalNameKey('Cafe\u0301'), canonicalNameKey('Café'));
});

test('ranking cron selects 03:00 Europe/Oslo across DST', () => {
  assert.equal(isOsloRefreshTime(new Date('2026-01-07T02:00:00Z')), true);
  assert.equal(isOsloRefreshTime(new Date('2026-07-08T01:00:00Z')), true);
  assert.equal(isOsloRefreshTime(new Date('2026-07-08T02:00:00Z')), false);
  assert.equal(isOsloRefreshTime(new Date('2026-07-09T01:00:00Z')), false);
});

test('ranking refresh updates individual ranking_value and roster Player_Value', async () => {
  fetchImpl = async (url) => {
    if (String(url).includes('tournament-config.json')) {
      return new Response(JSON.stringify({
        cup: { date: '5. september 2027', playersPerTeam: 1, maxSubstitutes: 0, registrationQuestions: [], rankingLevel: '10' },
        'test-individuell-2026': { date: '5. september 2027', playersPerTeam: null, maxSubstitutes: 0, registrationQuestions: [], rankingLevel: null },
      }));
    }
    if (String(url).includes('ranking.txt')) {
      const rows = [
        '1\t42\tTeam Player\tOslo BHK\tNOR\t123.45\t98.765',
        '2\t44\tSolo Player\tTrondheim BHK\tNOR\t100\t87.5',
      ];
      for (let i = 3; i <= 1000; i++) rows.push(`${i}\t${10000 + i}\tPlayer ${i}\t\tNOR\t1\t1`);
      return new Response(['header 1', 'header 2', ...rows].join('\n'));
    }
    throw new Error(`unexpected fetch: ${url}`);
  };

  let selectSql = '';
  const statements = [];
  const db = {
    prepare: (sql) => ({
      bind: (...params) => {
        if (sql.includes('SELECT id, tournament_slug')) {
          selectSql = sql;
          return { all: async () => ({ results: [
            { id: 1, tournament_slug: 'cup', type: 'team', name: 'Old', player_id: null, player_ids: '[42]', roster: '[{"playerId":42}]' },
            { id: 2, tournament_slug: 'test-individuell-2026', type: 'player', name: 'Old Solo', player_id: 44, player_ids: null, roster: null },
          ] }) };
        }
        const statement = { sql, params };
        statements.push(statement);
        return statement;
      },
    }),
    batch: async (batch) => batch,
  };

  const result = await refreshUpcomingRankings({ ...env, DB: db }, new Date('2026-08-05T01:00:00Z'));
  assert.equal(result.updated, 2);
  assert.match(selectSql, /ranking_value/);
  const teamUpdate = statements.find((statement) => statement.sql.includes('ranking_value = NULL'));
  const individualUpdate = statements.find((statement) => statement.sql.includes('ranking_value = ?'));
  assert.ok(teamUpdate);
  assert.ok(individualUpdate);
  assert.equal(JSON.parse(teamUpdate.params[4])[0].rankingValue, 98.765);
  assert.equal(individualUpdate.params[5], 87.5);
});

// ---------------- oauth flow ----------------

const req = (url, init = {}) => new Request(`https://worker.example${url}`, init);

test('metadata endpoints are well-formed', () => {
  const pr = oauth.protectedResource(req('/.well-known/oauth-protected-resource'));
  assert.equal(pr.status, 200);
  const as = oauth.authorizationServerMetadata(req('/.well-known/oauth-authorization-server'));
  assert.equal(as.status, 200);
});

test('full DCR → authorize → token flow (PKCE)', async () => {
  // 1. dynamic client registration
  const regRes = await oauth.register(
    req('/register', {
      method: 'POST',
      body: JSON.stringify({ redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }),
    }),
    env,
  );
  assert.equal(regRes.status, 201);
  const { client_id } = await regRes.json();
  assert.ok(client_id);

  // 2. authorize → redirect to GitHub with verifiable state
  const authorizeChallenge = 'A'.repeat(43);
  const authRes = await oauth.authorize(
    req(`/authorize?response_type=code&client_id=${encodeURIComponent(client_id)}` +
        `&redirect_uri=${encodeURIComponent('https://claude.ai/api/mcp/auth_callback')}` +
        `&state=clientstate&code_challenge=${authorizeChallenge}&code_challenge_method=S256`),
    { ...env, GITHUB_OAUTH_CLIENT_ID: 'gh-client-id' },
  );
  assert.equal(authRes.status, 302);
  const ghUrl = new URL(authRes.headers.get('Location'));
  assert.equal(ghUrl.host, 'github.com');
  assert.equal(ghUrl.searchParams.get('client_id'), 'gh-client-id');
  const st = await verify(ghUrl.searchParams.get('state'), SECRET);
  assert.equal(st.ru, 'https://claude.ai/api/mcp/auth_callback');
  assert.equal(st.st, 'clientstate');
  assert.equal(st.cc, authorizeChallenge);

  // 3. token: fabricate a code like /callback would issue
  const verifier = 'correct-horse-battery-staple-0123456789abcdef0123456789';
  const jti = 'one-use-code';
  const code = await sign(
    {
      sub: 'amundfylling', cc: await s256(verifier),
      ru: 'https://claude.ai/api/mcp/auth_callback', cid: client_id, jti,
      typ: 'code', exp: Math.floor(Date.now() / 1000) + 300,
    },
    SECRET,
  );
  const liveCodes = new Set([jti]);
  const db = {
    prepare: (sql) => ({
      bind: (...params) => ({
        run: async () => {
          if (!sql.startsWith('DELETE FROM oauth_codes WHERE jti')) return { meta: { changes: 0 } };
          const changed = liveCodes.delete(params[0]) ? 1 : 0;
          return { meta: { changes: changed } };
        },
      }),
    }),
  };
  const tokenRes = await oauth.token(
    req('/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code, code_verifier: verifier, client_id,
        redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      }).toString(),
    }),
    { ...env, DB: db },
  );
  assert.equal(tokenRes.status, 200);
  const tokens = await tokenRes.json();
  assert.equal(tokens.token_type, 'Bearer');
  const access = await verify(tokens.access_token, SECRET);
  assert.equal(access.sub, 'amundfylling');
  assert.equal(access.typ, 'access');

  // PKCE failure paths
  const badVerifier = await oauth.token(
    req('/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: 'wrong', client_id }).toString(),
    }),
    { ...env, DB: db },
  );
  assert.equal(badVerifier.status, 400);

  const replay = await oauth.token(
    req('/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: verifier, client_id }).toString(),
    }),
    { ...env, DB: db },
  );
  assert.equal(replay.status, 400);
  assert.equal(tokenRes.headers.get('Cache-Control'), 'no-store');
});

test('DCR accepts claimed HTTPS/native loopback callbacks and rejects unsafe redirects', async () => {
  for (const redirect of ['javascript:alert(1)', 'http://evil.example/cb', 'https://user:pass@example.com/cb', 'https://example.com/cb#fragment']) {
    const res = await oauth.register(
      req('/register', { method: 'POST', body: JSON.stringify({ redirect_uris: [redirect] }) }),
      env,
    );
    assert.equal(res.status, 400, redirect);
  }
  assert.equal(oauth.validRedirectUri('http://127.0.0.1:49152/callback'), true);
  assert.equal(oauth.validRedirectUri('https://chatgpt.com/connector/callback'), true);
});

test('GitHub callback requires explicit consent before issuing a persisted one-use code', async () => {
  const redirect = 'https://client.example/callback';
  const clientId = await sign({ uris: [redirect], name: 'Trusted client', typ: 'client' }, SECRET);
  const state = await sign({
    ru: redirect,
    st: 'client-state',
    cc: 'Z'.repeat(43),
    cid: clientId,
    cn: 'Trusted client',
    exp: Math.floor(Date.now() / 1000) + 300,
  }, SECRET);
  fetchImpl = async (url) => {
    const value = String(url);
    if (value.includes('/login/oauth/access_token')) {
      return new Response(JSON.stringify({ access_token: 'github-user-token' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (value === 'https://api.github.com/user') {
      return new Response(JSON.stringify({ login: 'board-member' }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (value.includes('/collaborators/board-member')) return new Response(null, { status: 204 });
    throw new Error(`unexpected fetch: ${value}`);
  };
  const callback = await oauth.callback(
    req(`/callback?state=${encodeURIComponent(state)}&code=github-code`),
    {
      ...env,
      GITHUB_OAUTH_CLIENT_ID: 'github-client',
      GITHUB_OAUTH_CLIENT_SECRET: 'github-secret',
      GITHUB_TOKEN: 'github-admin-token',
    },
  );
  assert.equal(callback.status, 200);
  assert.equal(callback.headers.get('X-Frame-Options'), 'DENY');
  const html = await callback.text();
  assert.match(html, /Gi administratortilgang/);
  assert.doesNotMatch(html, /client\.example\/callback\?code=/);
  const consent = html.match(/name="consent" value="([^"]+)"/)?.[1];
  assert.ok(consent);

  let insertedJti = null;
  const db = {
    prepare: (sql) => ({
      bind: (...params) => ({ sql, params, run: async () => ({ meta: { changes: 1 } }) }),
    }),
    batch: async (statements) => {
      const insert = statements.find((statement) => statement.sql.startsWith('INSERT INTO oauth_codes'));
      insertedJti = insert?.params[0] ?? null;
      return statements.map(() => ({ success: true }));
    },
  };
  const approved = await oauth.approve(
    req('/approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ consent, decision: 'allow' }).toString(),
    }),
    { ...env, DB: db },
  );
  assert.equal(approved.status, 303);
  const location = new URL(approved.headers.get('Location'));
  assert.equal(location.origin, 'https://client.example');
  const code = await verify(location.searchParams.get('code'), SECRET);
  assert.equal(code.jti, insertedJti);
  assert.equal(code.cid, clientId);
});

test('authorize rejects unregistered redirect_uri', async () => {
  const regRes = await oauth.register(
    req('/register', { method: 'POST', body: JSON.stringify({ redirect_uris: ['https://a.example/cb'] }) }),
    env,
  );
  const { client_id } = await regRes.json();
  const res = await oauth.authorize(
    req(`/authorize?response_type=code&client_id=${encodeURIComponent(client_id)}` +
        `&redirect_uri=${encodeURIComponent('https://evil.example/cb')}` +
        `&state=x&code_challenge=${'Y'.repeat(43)}&code_challenge_method=S256`),
    env,
  );
  assert.equal(res.status, 400);
});

test('authenticate accepts only valid access tokens', async () => {
  assert.equal(await oauth.authenticate(req('/mcp'), env), null);
  fetchImpl = async (url) => {
    assert.match(String(url), /\/collaborators\/amund$/);
    return new Response(null, { status: 204 });
  };
  const good = await sign({ sub: 'amund', typ: 'access', exp: Math.floor(Date.now() / 1000) + 60 }, SECRET);
  const user = await oauth.authenticate(
    req('/mcp', { headers: { Authorization: `Bearer ${good}` } }),
    { ...env, GITHUB_TOKEN: 'test' },
  );
  assert.equal(user.login, 'amund');
  const code = await sign({ sub: 'amund', typ: 'code', exp: Math.floor(Date.now() / 1000) + 60 }, SECRET);
  assert.equal(await oauth.authenticate(req('/mcp', { headers: { Authorization: `Bearer ${code}` } }), env), null);
});

// ---------------- MCP handler ----------------

const mcpReq = (body, method = 'POST') =>
  new Request('https://worker.example/mcp', {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });

test('initialize handshake', async () => {
  const res = await handleMcp(mcpReq({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }), env, 'tester');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.result.protocolVersion, '2025-06-18');
  assert.equal(body.result.serverInfo.name, 'puck-no-admin-remote');
  assert.ok(body.result.capabilities.tools);
});

test('tools/list exposes exactly 19 tools', async () => {
  assert.equal(TOOLS.length, 19);
  const res = await handleMcp(mcpReq({ jsonrpc: '2.0', id: 2, method: 'tools/list' }), env, 'tester');
  const body = await res.json();
  assert.equal(body.result.tools.length, 19);
  assert.ok(body.result.tools.every((t) => t.name && t.inputSchema));
});

test('unknown tool → JSON-RPC error, notifications → 202, GET → 405', async () => {
  const unknown = await handleMcp(mcpReq({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'nope' } }), env, 'tester');
  assert.equal((await unknown.json()).error.code, -32602);

  const notif = await handleMcp(mcpReq({ jsonrpc: '2.0', method: 'notifications/initialized' }), env, 'tester');
  assert.equal(notif.status, 202);

  const get = await handleMcp(mcpReq('', 'GET'), env, 'tester');
  assert.equal(get.status, 405);
});

test('public OAuth and MCP request bodies are bounded', async () => {
  const mcp = await handleMcp(mcpReq('x'.repeat(1024 * 1024 + 1)), env, 'tester');
  assert.equal(mcp.status, 413);

  const registration = await oauth.register(
    req('/register', { method: 'POST', body: 'x'.repeat(16 * 1024 + 1) }),
    env,
  );
  assert.equal(registration.status, 413);
});

test('tools/call surfaces validation errors without touching D1', async () => {
  // Config fetch stub — add_registration must reject the email before any DB call.
  fetchImpl = async (url) => {
    if (String(url).includes('tournament-config.json')) {
      return new Response(JSON.stringify({ 'test-individuell-2026': { playersPerTeam: null, maxSubstitutes: 0, registrationQuestions: [] } }));
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  const db = { prepare: () => { throw new Error('DB must not be called'); } };
  const res = await handleMcp(
    mcpReq({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'add_registration', arguments: { tournamentSlug: 'test-individuell-2026', email: 'not-an-email', name: 'Test' } } }),
    { ...env, DB: db },
    'tester',
  );
  const body = await res.json();
  assert.equal(body.result.isError, true);
  assert.match(body.result.content[0].text, /e-post/i);
});

test('tools/call enforces advertised schemas before a tool runs', async () => {
  const res = await handleMcp(
    mcpReq({ jsonrpc: '2.0', id: 40, method: 'tools/call', params: {
      name: 'add_registration', arguments: { tournamentSlug: 'cup', email: 42, unexpected: true },
    } }),
    env,
    'tester',
  );
  const body = await res.json();
  assert.equal(body.error.code, -32602);
  assert.match(body.error.message, /email.*tekst/);
});

test('add_registration happy path against a fake D1', async () => {
  fetchImpl = async (url) => {
    if (String(url).includes('tournament-config.json')) {
      return new Response(JSON.stringify({ 'test-individuell-2026': { playersPerTeam: null, maxSubstitutes: 0, registrationQuestions: [] } }));
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  const queries = [];
  const db = {
    prepare: (sql) => ({
      bind: (...params) => ({
        run: async () => {
          queries.push({ sql, params });
          return { meta: { last_row_id: 42, changes: 1 } };
        },
        all: async () => ({ results: [] }),
      }),
    }),
  };
  const res = await handleMcp(
    mcpReq({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'add_registration', arguments: { tournamentSlug: 'test-individuell-2026', email: 'Test@Test.no', name: 'Test Testesen' } } }),
    { ...env, DB: db },
    'tester',
  );
  const body = await res.json();
  assert.equal(body.result.isError, false);
  assert.match(body.result.content[0].text, /Registrert: Test Testesen/);
  assert.match(body.result.content[0].text, /t\*\*\*@test.no/); // masked
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /INSERT INTO registrations/);
  assert.ok(queries[0].params.includes('test@test.no')); // lowercased + bound, not interpolated
});

test('manual ranked registrations persist individual and roster Player_Value', async () => {
  const queries = [];
  const db = {
    prepare: (sql) => ({
      bind: (...params) => ({
        run: async () => {
          queries.push({ sql, params });
          return { meta: { last_row_id: 51, changes: 1 } };
        },
        all: async () => ({ results: [] }),
      }),
    }),
  };

  const individual = await handleMcp(
    mcpReq({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: {
      name: 'add_registration',
      arguments: { tournamentSlug: 'test-individuell-2026', email: 'solo@example.no', playerId: 44 },
    } }),
    { ...env, DB: db },
    'tester',
  );
  assert.equal((await individual.json()).result.isError, false);
  assert.match(queries[0].sql, /ranking_value/);
  assert.equal(queries[0].params[8], 87.5);

  const team = await handleMcp(
    mcpReq({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: {
      name: 'add_registration',
      arguments: { tournamentSlug: 'cup', email: 'team@example.no', playerIds: [42] },
    } }),
    { ...env, DB: db },
    'tester',
  );
  assert.equal((await team.json()).result.isError, false);
  const roster = JSON.parse(queries[1].params[7]);
  assert.equal(roster[0].rankingValue, 98.765);
  assert.equal(roster[0].rankingPoints, 123.45);
});
