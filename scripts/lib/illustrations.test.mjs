import assert from 'node:assert/strict';
import test from 'node:test';
import { validateIllustrationGraph, validateIllustrationScene } from './illustrations.mjs';

const scene = {
  slug: 'agdur',
  version: 1,
  rink: 'stiga-playoff-v1',
  viewport: { x: 0, y: 0, width: 415, height: 303 },
  paths: [
    { id: 'step-1', step: 1, kind: 'pass', curve: false, points: [[210, 227], [60, 262]], label: [210, 227] },
  ],
};

test('accepts a valid editable illustration', () => {
  assert.deepEqual(validateIllustrationScene(scene), []);
});

test('rejects out-of-rink points and non-consecutive steps', () => {
  const invalid = structuredClone(scene);
  invalid.paths[0].points[1] = [500, 800];
  invalid.paths.push({ id: 'step-3', step: 3, kind: 'shot', curve: false, points: [[1, 1], [2, 2]], label: [1, 1] });
  const errors = validateIllustrationScene(invalid);
  assert.ok(errors.some((error) => error.includes('points[1].x')));
  assert.ok(errors.some((error) => error.includes('steps must be consecutive')));
});

test('requires one same-slug trick reference per illustration', () => {
  assert.deepEqual(validateIllustrationGraph([{ slug: 'agdur', illustration: 'agdur' }], [scene]), []);
  assert.ok(validateIllustrationGraph([{ slug: 'agdur', illustration: 'missing' }], [scene]).some((error) => error.includes('missing illustration')));
  assert.ok(validateIllustrationGraph([], [scene]).some((error) => error.includes('not referenced')));
});
