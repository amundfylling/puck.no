import assert from 'node:assert/strict';
import test from 'node:test';

import { parseRanking } from './ranking.ts';
import { calculatePlacementPoints, RANKING_LEVELS } from './ranking-points.ts';

test('matches the seven-player World Championship example in WR 2020 chapter 3.6', () => {
  const result = calculatePlacementPoints('1-world', [1000, 990, 950, 900, 890, 0, 0]);
  assert.deepEqual(result.map((row) => row.points), [1010, 896, 667, 501, 334, 168, 1]);
  assert.deepEqual(result[0].methods, {
    playersBeaten: 922,
    numberBeaten: 7,
    scaling: 1000,
    linear: 1000,
  });
});

test('uses the continental level-one winner guarantee', () => {
  const result = calculatePlacementPoints('1-continental', [0, 0, 0, 0]);
  assert.equal(result[0].points, 610);
  assert.equal(result.at(-1)?.points, 1);
});

test('caps the number-beaten method at 70 before the winner bonus', () => {
  const result = calculatePlacementPoints('6', Array.from({ length: 400 }, () => 0));
  assert.equal(result[0].methods.numberBeaten, 70);
  assert.equal(result[0].points, 80);
  assert.equal(result[1].methods.numberBeaten, 70);
  assert.equal(result.at(-1)?.points, 1);
});

test('awards no points below four entrants or for level ten team competitions', () => {
  assert.deepEqual(calculatePlacementPoints('4', [800, 700, 600]).map((row) => row.points), [0, 0, 0]);
  assert.deepEqual(calculatePlacementPoints('10', [800, 700, 600, 500]).map((row) => row.points), [0, 0, 0, 0]);
});

test('points never increase for a lower placement', () => {
  for (const level of ['1-world', '1-continental', '2', '3', '4', '5', '6'] as const) {
    const points = calculatePlacementPoints(level, [1010, 895, 700, 430, 100, 0, 0, 0]);
    for (let index = 1; index < points.length; index += 1) {
      assert.ok(points[index].points <= points[index - 1].points, `${level}: ${index + 1}`);
    }
  }
});

test('uses the WR 2020 coefficient for every tournament level', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(RANKING_LEVELS).map(([level, rule]) => [level, rule.coefficient])),
    {
      '1-world': 0.96,
      '1-continental': 0.96,
      '2': 0.92,
      '3': 0.89,
      '4': 0.83,
      '5': 0.60,
      '6': 0.40,
    },
  );
});

test('rejects ranked feed rows with blank points or Player_Value', () => {
  const ranking = parseRanking([
    'ranking title',
    'Rank\tID_Player\tPlayer\tClub\tNation\tPoints\tPlayer_Value',
    '1\t42\tComplete Player\tOslo BHK\tNOR\t123.45\t98.765',
    '2\t43\tBlank Value\tOslo BHK\tNOR\t12\t',
    '3\t44\tBlank Points\tOslo BHK\tNOR\t\t10',
  ].join('\n'));
  assert.deepEqual([...ranking.keys()], [42]);
  assert.equal(ranking.get(42)?.points, 123.45);
  assert.equal(ranking.get(42)?.value, 98.765);
});
