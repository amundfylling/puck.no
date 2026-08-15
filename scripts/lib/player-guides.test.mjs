import assert from 'node:assert/strict';
import test from 'node:test';

import {
  defaultIllustrationPlayers,
  snapPointToPlayerGuide,
} from '../../src/lib/illustrations.ts';

test('new illustrations start with a complete role-based lineup', () => {
  const players = defaultIllustrationPlayers();
  assert.equal(players.length, 6);
  assert.deepEqual(
    new Set(players.map((player) => player.role)),
    new Set(['left-wing', 'center', 'right-wing', 'left-defense', 'right-defense', 'goalie']),
  );
});

test('role-based placement snaps to a rod while role-less placement stays free', () => {
  assert.deepEqual(snapPointToPlayerGuide([40, 40], 'center'), [210.9, 210.9]);
  assert.deepEqual(snapPointToPlayerGuide([40, 40], null), [40, 40]);
  assert.deepEqual(snapPointToPlayerGuide([208, 143], 'goalie'), [206.6, 162.2]);
});
