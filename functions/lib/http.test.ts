import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BodyTooLargeError,
  readRequestTextLimited,
  readResponseTextLimited,
} from './http.ts';

test('bounded body readers enforce declared and streamed byte limits', async () => {
  const request = new Request('https://www.puck.no/api/registrations', {
    method: 'POST',
    body: 'æøå',
  });
  assert.equal(await readRequestTextLimited(request, 6), 'æøå');

  await assert.rejects(
    () => readResponseTextLimited(
      new Response('short', { headers: { 'Content-Length': '100' } }),
      10,
    ),
    BodyTooLargeError,
  );
  await assert.rejects(
    () => readResponseTextLimited(new Response('ø'.repeat(6)), 10),
    BodyTooLargeError,
  );
});
