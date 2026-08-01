import assert from 'node:assert/strict';
import test from 'node:test';

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { onRequest as adminMiddleware } from '../api/admin/_middleware.ts';

import {
  accessIssuer,
  adminIdentity,
  adminMutationProblem,
  verifyAccessToken,
} from './admin-auth.ts';
import { csvField } from './csv.ts';
import { canonicalNameKey } from './ranking.ts';
import {
  isIsoCalendarDate,
  isPastTournamentDate,
  osloDate,
} from './tournament-date.ts';

test('normalizes only valid Cloudflare Access issuers', () => {
  assert.equal(accessIssuer('nbhf'), 'https://nbhf.cloudflareaccess.com');
  assert.equal(
    accessIssuer('NBHF.cloudflareaccess.com'),
    'https://nbhf.cloudflareaccess.com',
  );
  assert.equal(
    accessIssuer('https://nbhf.cloudflareaccess.com/'),
    'https://nbhf.cloudflareaccess.com',
  );
  assert.equal(accessIssuer('https://example.com'), null);
  assert.equal(accessIssuer('nbhf.cloudflareaccess.com.evil.test'), null);
  assert.equal(accessIssuer('https://nbhf.cloudflareaccess.com/keys'), null);
  assert.equal(accessIssuer(undefined), null);
});

test('verifies the Access signature, issuer, audience, expiry and identity claims', async () => {
  const issuer = 'https://nbhf.cloudflareaccess.com';
  const audience = 'expected-application-audience';
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  const keys = createLocalJWKSet({ keys: [{ ...jwk, alg: 'RS256', kid: 'test-key' }] });
  const token = await new SignJWT({ email: 'Board.Member@puck.no', type: 'app' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(issuer)
    .setAudience([audience])
    .setSubject('access-user-id')
    .setIssuedAt()
    .setNotBefore(Math.floor(Date.now() / 1_000) - 1)
    .setExpirationTime('5m')
    .sign(privateKey);

  assert.deepEqual(await verifyAccessToken(token, issuer, audience, keys), {
    email: 'board.member@puck.no',
    subject: 'access-user-id',
  });
  await assert.rejects(verifyAccessToken(token, issuer, 'wrong-audience', keys));
  await assert.rejects(
    verifyAccessToken(token, 'https://other.cloudflareaccess.com', audience, keys),
  );

  const { privateKey: wrongPrivateKey } = await generateKeyPair('RS256');
  const forged = await new SignJWT({ email: 'board.member@puck.no', type: 'app' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(issuer)
    .setAudience([audience])
    .setSubject('access-user-id')
    .setIssuedAt()
    .setNotBefore(Math.floor(Date.now() / 1_000) - 1)
    .setExpirationTime('5m')
    .sign(wrongPrivateKey);
  await assert.rejects(verifyAccessToken(forged, issuer, audience, keys));

  const expired = await new SignJWT({ email: 'board.member@puck.no', type: 'app' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(issuer)
    .setAudience([audience])
    .setSubject('access-user-id')
    .setIssuedAt(Math.floor(Date.now() / 1_000) - 60)
    .setNotBefore(Math.floor(Date.now() / 1_000) - 60)
    .setExpirationTime(Math.floor(Date.now() / 1_000) - 30)
    .sign(privateKey);
  await assert.rejects(verifyAccessToken(expired, issuer, audience, keys));

  const noExpiry = await new SignJWT({ email: 'board.member@puck.no', type: 'app' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer(issuer)
    .setAudience([audience])
    .setSubject('access-user-id')
    .setIssuedAt()
    .setNotBefore(Math.floor(Date.now() / 1_000) - 1)
    .sign(privateKey);
  await assert.rejects(verifyAccessToken(noExpiry, issuer, audience, keys));
});

test('admin middleware fails closed and passes only a verified identity downstream', async () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  let denied: Response | void;
  try {
    denied = await adminMiddleware({
      env: {},
      request: new Request('https://puck.no/api/admin/overview.json', {
        headers: { 'Cf-Access-Authenticated-User-Email': 'spoofed@example.com' },
      }),
      data: {},
    } as never);
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(denied?.status, 503);

  const issuer = 'https://middleware-test.cloudflareaccess.com';
  const audience = 'middleware-audience';
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  const token = await new SignJWT({ email: 'verified@puck.no', type: 'app' })
    .setProtectedHeader({ alg: 'RS256', kid: 'middleware-key' })
    .setIssuer(issuer)
    .setAudience([audience])
    .setSubject('verified-user')
    .setIssuedAt()
    .setNotBefore(Math.floor(Date.now() / 1_000) - 1)
    .setExpirationTime('5m')
    .sign(privateKey);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    assert.equal(String(input), `${issuer}/cdn-cgi/access/certs`);
    return new Response(JSON.stringify({
      keys: [{ ...jwk, alg: 'RS256', kid: 'middleware-key', use: 'sig' }],
    }), { headers: { 'Content-Type': 'application/json' } });
  };
  try {
    const data: Record<string, unknown> = {};
    const response = await adminMiddleware({
      env: { ACCESS_TEAM_NAME: 'middleware-test', ACCESS_POLICY_AUD: audience },
      request: new Request('https://puck.no/api/admin/overview.json', {
        headers: { 'Cf-Access-Jwt-Assertion': token },
      }),
      data,
      next: async () => new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json' },
      }),
    } as never);
    assert.equal(response?.status, 200);
    assert.equal(response?.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual((data as { adminIdentity?: unknown }).adminIdentity, {
      email: 'verified@puck.no',
      subject: 'verified-user',
    });

    let crossOriginReachedHandler = false;
    const crossOrigin = await adminMiddleware({
      env: { ACCESS_TEAM_NAME: 'middleware-test', ACCESS_POLICY_AUD: audience },
      request: new Request('https://puck.no/api/admin/registrations', {
        method: 'POST',
        headers: {
          'Cf-Access-Jwt-Assertion': token,
          'Content-Type': 'application/json',
          Origin: 'https://evil.example',
        },
        body: '{}',
      }),
      data: {},
      next: async () => {
        crossOriginReachedHandler = true;
        return new Response();
      },
    } as never);
    assert.equal(crossOrigin?.status, 403);
    assert.equal(crossOriginReachedHandler, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('downstream admin identity must come from verified request data', () => {
  assert.equal(adminIdentity(undefined), null);
  assert.equal(adminIdentity({ 'Cf-Access-Authenticated-User-Email': 'spoofed@example.com' }), null);
  assert.deepEqual(
    adminIdentity({ adminIdentity: { email: 'board@example.com', subject: 'user-id' } }),
    { email: 'board@example.com', subject: 'user-id' },
  );
});

test('admin mutations require same-origin JSON requests', () => {
  assert.equal(adminMutationProblem(new Request('https://puck.no/api/admin/overview.json')), null);
  assert.equal(
    adminMutationProblem(new Request('https://puck.no/api/admin/registrations', { method: 'POST' }))
      ?.status,
    415,
  );
  assert.equal(
    adminMutationProblem(new Request('https://puck.no/api/admin/registrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }))?.status,
    403,
  );
  assert.equal(
    adminMutationProblem(new Request('https://puck.no/api/admin/registrations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Origin: 'https://evil.example',
      },
    }))?.status,
    403,
  );
  assert.equal(
    adminMutationProblem(new Request('https://puck.no/api/admin/registrations', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://puck.no',
        'Sec-Fetch-Site': 'same-origin',
      },
    })),
    null,
  );
});

test('CSV cells neutralize spreadsheet formulas without changing ordinary text', () => {
  assert.equal(csvField('ordinary "name"'), '"ordinary ""name"""');
  assert.equal(csvField('=HYPERLINK("https://evil.example")'), '"\'=HYPERLINK(""https://evil.example"")"');
  assert.equal(csvField('\t-2+3'), '"\'\t-2+3"');
  assert.equal(csvField('\uFEFF=1+1'), '"\'\uFEFF=1+1"');
  assert.equal(csvField('+47 123 45 678'), '"\'+47 123 45 678"');
});

test('unranked duplicate keys use Unicode normalization and Norwegian case folding', () => {
  assert.equal(canonicalNameKey('  Åge\u00a0 Hansen '), canonicalNameKey('åGE Hansen'));
  assert.equal(canonicalNameKey('Cafe\u0301'), canonicalNameKey('Café'));
});

test('registration closes after the final Europe/Oslo calendar date', () => {
  assert.equal(osloDate(new Date('2026-09-05T21:59:59Z')), '2026-09-05');
  assert.equal(osloDate(new Date('2026-09-05T22:00:00Z')), '2026-09-06');
  assert.equal(isPastTournamentDate('2026-09-05', new Date('2026-09-05T21:59:59Z')), false);
  assert.equal(isPastTournamentDate('2026-09-05', new Date('2026-09-05T22:00:00Z')), true);
  assert.equal(isPastTournamentDate('2026-01-17', new Date('2026-01-17T22:59:59Z')), false);
  assert.equal(isPastTournamentDate('2026-01-17', new Date('2026-01-17T23:00:00Z')), true);
  assert.equal(isIsoCalendarDate('2024-02-29'), true);
  assert.equal(isIsoCalendarDate('2026-02-29'), false);
  assert.throws(() => isPastTournamentDate('2026-99-99'));
});
