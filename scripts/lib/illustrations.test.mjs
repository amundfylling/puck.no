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
  players: [
    { id: 'attacking-center', kind: 'attacker', role: 'center', position: [210, 227], rotation: -90, scale: 0.95 },
    { id: 'defending-goalie', kind: 'goalie', role: 'goalie', position: [208, 143], rotation: 180, scale: 0.9 },
  ],
  puck: null,
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

test('allows curves only for puck paths that follow the wall behind a goal', () => {
  const invalid = structuredClone(scene);
  invalid.paths[0].curve = true;
  assert.ok(validateIllustrationScene(invalid).some((error) => error.includes('must set followsWall to true')));

  const wallRoute = structuredClone(scene);
  wallRoute.paths[0].curve = true;
  wallRoute.paths[0].followsWall = true;
  wallRoute.paths[0].points = [[60, 190], [46, 90], [208, 56], [369, 90], [355, 190]];
  assert.deepEqual(validateIllustrationScene(wallRoute), []);
});

test('validates player sprites and rejects separate puck markers', () => {
  const invalid = structuredClone(scene);
  invalid.players[0].position = [-1, 900];
  invalid.players[1].id = invalid.players[0].id;
  invalid.players[1].scale = 2;
  invalid.puck = { position: [207, 215], radius: 5 };
  const errors = validateIllustrationScene(invalid);
  assert.ok(errors.some((error) => error.includes('players[0].position.x')));
  assert.ok(errors.some((error) => error.includes('players[1].id is duplicated')));
  assert.ok(errors.some((error) => error.includes('players[1].scale')));
  assert.ok(errors.some((error) => error.includes('puck must be null')));
});

test('requires one same-slug trick reference per illustration', () => {
  assert.deepEqual(validateIllustrationGraph([{ slug: 'agdur', illustration: 'agdur' }], [scene]), []);
  assert.ok(validateIllustrationGraph([{ slug: 'agdur', illustration: 'missing' }], [scene]).some((error) => error.includes('missing illustration')));
  assert.ok(validateIllustrationGraph([], [scene]).some((error) => error.includes('not referenced')));
});
