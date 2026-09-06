import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { illustrationMarkup } from '../../src/lib/illustration-renderer.ts';
import { parseScene } from '../../src/lib/illustration-scene.ts';
const original = JSON.parse(readFileSync(new URL('../../src/content/illustrations/agdur.json', import.meta.url), 'utf8'));

test('draft preview renders current points with the public renderer and no editor overlays', () => {
  const scene = parseScene(original, 'agdur');
  scene.paths[0].points[0] = [12, 34];
  const draft = illustrationMarkup(scene, 'preview');
  const publicMarkup = illustrationMarkup(scene, 'public');
  assert.equal(draft.replaceAll('preview', 'public'), publicMarkup);
  assert.match(draft, /M 12 34/);
  assert.doesNotMatch(draft, /data-player-id|data-point-index|editor-grid/);
});

test('shared validation rejects invalid curves, coordinates and excessive steps', () => {
  const badCurve = structuredClone(original);
  badCurve.paths[0] = { ...badCurve.paths[0], kind: 'pass', curve: true, followsWall: false };
  assert.throws(() => parseScene(badCurve, 'agdur'));
  const badPoint = structuredClone(original);
  badPoint.paths[0].points[0] = [Infinity, 10];
  assert.throws(() => parseScene(badPoint, 'agdur'));
  const tooMany = { ...original, paths: Array.from({ length: 21 }, () => original.paths[0]) };
  assert.throws(() => parseScene(tooMany, 'agdur'));
});
