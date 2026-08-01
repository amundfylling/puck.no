import assert from 'node:assert/strict';
import test from 'node:test';

import { readResponseTextLimited, ResponseTooLargeError } from './bounded-response.mjs';

test('bounded response reader counts UTF-8 bytes and declared lengths', async () => {
  assert.equal(await readResponseTextLimited(new Response('æøå'), 6), 'æøå');
  await assert.rejects(
    () => readResponseTextLimited(new Response('ok', { headers: { 'Content-Length': '20' } }), 10),
    ResponseTooLargeError,
  );
  await assert.rejects(
    () => readResponseTextLimited(new Response('ø'.repeat(6)), 10),
    ResponseTooLargeError,
  );
});
