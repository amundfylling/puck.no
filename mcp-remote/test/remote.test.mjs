/** Unit tests for the remote worker — pure logic + mocked env/fetch/DB. */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { b64url, b64urlDecode, sign, verify, s256 } from '../src/lib/crypto.js';
import { parseMdText, patchMdText, createMdText } from '../src/lib/frontmatter.js';
import { parseRanking } from '../src/lib/ranking.js';
import {
  assertRankingLevel, assertTournamentRankingLevel, RANKING_LEVELS, ValidationError,
} from '../src/lib/validate.js';
import {
  regenerateConfigPreview, TOURNAMENT_PATCHABLE, TOURNAMENT_SYNC_TO_EN,
} from '../src/tools/contenttools.js';
import * as oauth from '../src/oauth.js';
import { handleMcp, TOOLS } from '../src/mcp.js';
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

test('ITHF ranking parser keeps total points separate from exact Player_Value', () => {
  const tsv = [
    'header 1',
    'header 2',
    '1\t42\tValue Player\tOslo BHK\tNOR\t123.45\t98.765',
    '2\t43\tNo Value\t\tSWE\t12\t',
  ].join('\n');
  const { byId } = parseRanking(tsv);
  assert.equal(byId.get(42).points, 123.45);
  assert.equal(byId.get(42).value, 98.765);
  assert.equal(byId.get(43).value, null);
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
      return new Response([
        'header 1',
        'header 2',
        '1\t42\tTeam Player\tOslo BHK\tNOR\t123.45\t98.765',
        '2\t44\tSolo Player\tTrondheim BHK\tNOR\t100\t87.5',
      ].join('\n'));
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
  const authRes = await oauth.authorize(
    req(`/authorize?response_type=code&client_id=${encodeURIComponent(client_id)}` +
        `&redirect_uri=${encodeURIComponent('https://claude.ai/api/mcp/auth_callback')}` +
        `&state=clientstate&code_challenge=CHALLENGE&code_challenge_method=S256`),
    { ...env, GITHUB_OAUTH_CLIENT_ID: 'gh-client-id' },
  );
  assert.equal(authRes.status, 302);
  const ghUrl = new URL(authRes.headers.get('Location'));
  assert.equal(ghUrl.host, 'github.com');
  assert.equal(ghUrl.searchParams.get('client_id'), 'gh-client-id');
  const st = await verify(ghUrl.searchParams.get('state'), SECRET);
  assert.equal(st.ru, 'https://claude.ai/api/mcp/auth_callback');
  assert.equal(st.st, 'clientstate');
  assert.equal(st.cc, 'CHALLENGE');

  // 3. token: fabricate a code like /callback would issue
  const verifier = 'correct-horse-battery-staple-0123456789abcdef0123456789';
  const code = await sign(
    { sub: 'amundfylling', cc: await s256(verifier), ru: 'https://claude.ai/api/mcp/auth_callback', typ: 'code', exp: Math.floor(Date.now() / 1000) + 300 },
    SECRET,
  );
  const tokenRes = await oauth.token(
    req('/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code, code_verifier: verifier,
        redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
      }).toString(),
    }),
    env,
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
      body: new URLSearchParams({ grant_type: 'authorization_code', code, code_verifier: 'wrong' }).toString(),
    }),
    env,
  );
  assert.equal(badVerifier.status, 400);
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
        `&state=x&code_challenge=Y&code_challenge_method=S256`),
    env,
  );
  assert.equal(res.status, 400);
});

test('authenticate accepts only valid access tokens', async () => {
  assert.equal(await oauth.authenticate(req('/mcp'), env), null);
  const good = await sign({ sub: 'amund', typ: 'access', exp: Math.floor(Date.now() / 1000) + 60 }, SECRET);
  const user = await oauth.authenticate(req('/mcp', { headers: { Authorization: `Bearer ${good}` } }), env);
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
