import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { norwegianEndDate } from './tournament-date.mjs';

test('turneringsgeneratoren lager ISO-sluttdato fra norske datoer', () => {
  assert.equal(norwegianEndDate('5. september 2026'), '2026-09-05');
  assert.equal(norwegianEndDate('1.–3. mai 2026'), '2026-05-03');
  assert.equal(norwegianEndDate('1-3 mai 2026'), '2026-05-03');
  assert.equal(norwegianEndDate('31. februar 2026'), null);
  assert.equal(norwegianEndDate('ukjent dato'), null);
});

test('generert API-konfigurasjon utelater interne draft-turneringer', async () => {
  const raw = await readFile(new URL('../../functions/lib/tournament-config.json', import.meta.url));
  const config = JSON.parse(raw);
  assert.equal('test-individuell-2026' in config, false);
  assert.equal('test-lagturnering-2026' in config, false);
  for (const tournament of Object.values(config)) {
    assert.match(tournament.endDate, /^\d{4}-\d{2}-\d{2}$/);
  }
});
