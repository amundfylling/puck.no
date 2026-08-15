import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { traceLegacyIllustration } from './legacy-illustration-tracer.mjs';

const publicAsset = (filename) => fileURLToPath(new URL(`../../public/media/images/${filename}`, import.meta.url));

test('reads numbered starts and shot direction from a short legacy move', async () => {
  const result = await traceLegacyIllustration(publicAsset('trick-nacka-2e6af9fd.png'));
  assert.equal(result.paths.length, 2);
  assert.deepEqual(result.paths[0][0], result.labels[0].point);
  assert.deepEqual(result.paths[0].at(-1), result.labels[1].point);
  assert.deepEqual(result.paths[1][0], result.labels[1].point);
  assert.ok(result.paths[1].at(-1)[1] < result.paths[1][0][1]);
});

test('keeps a rail route before the return pass', async () => {
  const result = await traceLegacyIllustration(publicAsset('trick-holms-gretzky-0e16faa4.png'));
  assert.equal(result.paths.length, 3);
  assert.ok(result.paths[0].length > 5);
  assert.deepEqual(result.paths[0].at(-1), result.paths[1][0]);
  assert.deepEqual(result.paths[1].at(-1), result.paths[2][0]);
});
