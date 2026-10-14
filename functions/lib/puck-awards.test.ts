import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NominationError, nominationsOpen, parseNominations, type AwardsConfig } from './puck-awards.ts';

const config: AwardsConfig = {
  year: 2027,
  open: true,
  nominationsClose: '2027-04-02',
  categories: [
    { id: 'sportspucken', name: 'Sportspucken' },
    { id: 'hjemaspucken', name: 'Hjemåspucken' },
  ],
};

test('nominations close after the last Norwegian calendar date', () => {
  assert.equal(nominationsOpen(config, new Date('2027-04-02T21:59:00Z')), true);
  assert.equal(nominationsOpen(config, new Date('2027-04-02T22:01:00Z')), false);
  assert.equal(nominationsOpen({ ...config, open: false }, new Date('2026-10-14T12:00:00Z')), false);
});

test('empty categories are skipped and text is normalised', () => {
  const parsed = parseNominations({
    nominations: {
      sportspucken: { nominee: '  Ola\tNordmann ', reason: 'Vant alt.\r\n\r\n\r\n\r\nIgjen.' },
      hjemaspucken: { nominee: '', reason: '' },
    },
    nominator: '   ',
  }, config);
  assert.deepEqual(parsed, {
    nominations: [{ category: 'sportspucken', nominee: 'Ola Nordmann', reason: 'Vant alt.\n\nIgjen.' }],
    nominator: null,
  });
});

test('rejects unknown categories, empty submissions and reasons without a nominee', () => {
  assert.throws(() => parseNominations({ nominations: { tullepucken: { nominee: 'X' } } }, config), NominationError);
  assert.throws(() => parseNominations({ nominations: { sportspucken: { nominee: ' ' } } }, config), /minst én/);
  assert.throws(() => parseNominations({ nominations: { sportspucken: { reason: 'Fordi' } } }, config), /hvem du nominerer/);
  assert.throws(() => parseNominations({ nominations: [] }, config), NominationError);
  assert.throws(
    () => parseNominations({ nominations: { sportspucken: { nominee: 'x'.repeat(121) } } }, config),
    /maks 120/,
  );
});
