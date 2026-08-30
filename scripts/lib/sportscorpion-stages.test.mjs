import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isSportScorpionStageArray,
  parseSportScorpionStages,
  validateSportScorpionSnapshot,
} from '../../functions/lib/sportscorpion.js';

const html = `
  <table class="sTable stages-table">
    <tr><th></th><th>Name</th><th>Status</th><th></th></tr>
    <tr>
      <td>1</td><td>Cup &amp; finals</td><td>Not started</td>
      <td><a href="/eng/tournament/stage/23766/matches/">Schedule</a> |
          <a href="/eng/tournament/stage/23766/draws/">Draws</a></td>
    </tr>
    <tr>
      <td>2</td><td>Group Stage</td><td>Not started</td>
      <td><a href="/eng/tournament/stage/23764/matches/">Schedule</a> |
          <a href="/eng/tournament/stage/23764/results/">Tables</a></td>
    </tr>
  </table>`;

test('parses stage ids, provider names, order and result types', () => {
  assert.deepEqual(parseSportScorpionStages(html), [
    { id: 23766, name: 'Cup & finals', type: 'bracket' },
    { id: 23764, name: 'Group Stage', type: 'table' },
  ]);
});

test('ignores unrelated or incomplete markup and validates snapshots', () => {
  assert.deepEqual(parseSportScorpionStages('<table><tr><td>Other</td></tr></table>'), []);
  assert.equal(validateSportScorpionSnapshot({ 8171: parseSportScorpionStages(html) }), true);
  assert.equal(validateSportScorpionSnapshot({ 8171: [{ id: 1, name: '', type: 'table' }] }), false);
});

test('stage-array validation accepts only bounded, complete stages', () => {
  assert.equal(isSportScorpionStageArray([{ id: 1, name: 'Cup', type: 'bracket' }]), true);
  assert.equal(isSportScorpionStageArray([{ id: 0, name: 'Cup', type: 'bracket' }]), false);
  assert.equal(isSportScorpionStageArray([{ id: 1, name: '', type: 'table' }]), false);
});
