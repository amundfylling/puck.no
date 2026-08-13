import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TURNSTILE_REGISTRATION_ACTION } from '../../src/lib/turnstile.ts';
import {
  MAX_TURNSTILE_TOKEN_LENGTH,
  parseTurnstileHostnames,
  verifyTurnstile,
} from './turnstile.ts';

const allowed = parseTurnstileHostnames('puck.no, www.puck.no,puck-no.pages.dev');

function siteverify(data: Record<string, unknown>, status = 200) {
  return async () => Response.json(data, { status });
}

test('Turnstile accepts only the registration action on an allowed hostname', async () => {
  assert.equal(await verifyTurnstile('secret', 'token', '192.0.2.1', allowed, siteverify({
    success: true,
    action: TURNSTILE_REGISTRATION_ACTION,
    hostname: 'www.puck.no',
  })), true);

  assert.equal(await verifyTurnstile('secret', 'token', null, allowed, siteverify({
    success: true,
    action: 'newsletter_signup',
    hostname: 'www.puck.no',
  })), false);

  assert.equal(await verifyTurnstile('secret', 'token', null, allowed, siteverify({
    success: true,
    action: TURNSTILE_REGISTRATION_ACTION,
    hostname: 'attacker.example',
  })), false);
});

test('Turnstile rejects oversized tokens before making a network request', async () => {
  let called = false;
  const fetcher = async () => {
    called = true;
    return Response.json({ success: true });
  };
  assert.equal(
    await verifyTurnstile('secret', 'x'.repeat(MAX_TURNSTILE_TOKEN_LENGTH + 1), null, allowed, fetcher),
    false,
  );
  assert.equal(called, false);
});

test('Turnstile hostname configuration accepts exact hosts and rejects wildcards and URLs', () => {
  assert.deepEqual(
    [...parseTurnstileHostnames('puck.no,*.puck.no, https://www.puck.no,LOCALHOST')],
    ['puck.no', 'localhost'],
  );
});
