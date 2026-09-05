import assert from 'node:assert/strict';
import test from 'node:test';
import { tournamentDayStatus } from '../../src/lib/dates.ts';

test('Norway Open becomes ongoing at Norwegian midnight and past the following midnight', () => {
  const status = (instant) => tournamentDayStatus('5. september 2026', new Date(instant));
  assert.equal(status('2026-09-04T21:59:59.999Z'), 'upcoming');
  assert.equal(status('2026-09-04T22:00:00.000Z'), 'ongoing');
  assert.equal(status('2026-09-05T12:00:00.000Z'), 'ongoing');
  assert.equal(status('2026-09-05T21:59:59.999Z'), 'ongoing');
  assert.equal(status('2026-09-05T22:00:00.000Z'), 'past');
});

test('winter events use Norwegian standard time', () => {
  assert.equal(tournamentDayStatus('17. januar 2026', new Date('2026-01-16T22:59:59Z')), 'upcoming');
  assert.equal(tournamentDayStatus('17. januar 2026', new Date('2026-01-16T23:00:00Z')), 'ongoing');
  assert.equal(tournamentDayStatus('17. januar 2026', new Date('2026-01-17T23:00:00Z')), 'past');
});

test('multi-day events remain ongoing through the last day, including across daylight saving', () => {
  for (const date of ['28.–30. mars 2026', '28-30 mars 2026', '28—30 mars 2026']) {
    assert.equal(tournamentDayStatus(date, new Date('2026-03-27T22:59:59Z')), 'upcoming');
    assert.equal(tournamentDayStatus(date, new Date('2026-03-27T23:00:00Z')), 'ongoing');
    assert.equal(tournamentDayStatus(date, new Date('2026-03-29T10:00:00Z')), 'ongoing');
    assert.equal(tournamentDayStatus(date, new Date('2026-03-30T21:59:59Z')), 'ongoing');
    assert.equal(tournamentDayStatus(date, new Date('2026-03-30T22:00:00Z')), 'past');
  }
});

test('invalid or unknown dates do not produce an ongoing event', () => {
  for (const date of ['', 'TBA', '31. februar 2026', '3.–1. mai 2026', '0. mai 2026', '5. unknown 2026']) {
    assert.equal(tournamentDayStatus(date), null, date);
  }
});
