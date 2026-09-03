import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildQualificationData,
  classifyTournament,
  QUALIFICATION_DATA_VERSION,
  parseCalendarHtml,
  parsePlayerHtml,
  parseSharedThird,
  validateQualificationData,
} from './qualification.mjs';

test('parses ITHF calendar, player history and shared bronze tables', () => {
  const calendar = `<span id="LabTournaments"><table><tr><td><table><tr><td>Date</td></tr>
    <tr><td>05.09.2026</td><td><a href="tournament.aspx?id=42">Norway &amp; Open</a></td><td></td><td>Sandnes (NOR)</td><td>World Tour</td><td>A</td><td>20</td></tr>
    </table></td></tr></table></span>`;
  assert.deepEqual(parseCalendarHtml(calendar), [{
    id: 42, date: '2026-09-05', name: 'Norway & Open', city: 'Sandnes (NOR)', country: 'NOR',
  }]);

  const profile = `<span id="LabRank"><table><tr><td>Ladies ranking</td><td>9.</td></tr></table></span>
    <span id="LabBirth">2014</span><span id="LabTournaments">
    <tr><td>05.09.2026</td><td><a href="tournament.aspx?ID=42">Norway &amp; Open</a></td><td></td><td>World Tour</td><td>Sandnes (NOR)</td><td>3. (20)</td><td>450</td></tr>
    </span>`;
  assert.deepEqual(parsePlayerHtml(profile, { id: 7, name: 'Test Player' }), {
    id: 7,
    name: 'Test Player',
    birthYear: 2014,
    isWoman: true,
    results: [{
      tournamentId: 42,
      date: '2026-09-05',
      name: 'Norway & Open',
      country: 'NOR',
      position: 3,
      ithfPoints: 450,
    }],
  });

  const standings = `<span id="LabTable">
    <tr><td>3.</td><td></td><td></td><td>A</td><td></td><td>Norway</td><td>400</td></tr>
    <tr><td>3.</td><td></td><td></td><td>B</td><td></td><td>Sweden</td><td>400</td></tr>
  </span>`;
  assert.equal(parseSharedThird(standings), true);
});

test('classifies all supported championship categories', () => {
  assert.equal(classifyTournament('Norwegian Championships 2027'), 'open');
  assert.equal(classifyTournament('Norwegian Championships 2027 Women'), 'women');
  assert.equal(classifyTournament('World Championships 2025 Juniors'), 'junior');
  assert.equal(classifyTournament('European Championships 2026 Kids (U-13)'), 'kids');
  assert.equal(classifyTournament('Swedish Championships 2026 Veterans'), 'veteran');
  assert.equal(classifyTournament('World Championships 2025 SuperVeterans (55+)'), 'superveteran');
});

test('applies guarantee, top-eight and category quotas', () => {
  const tournament = { id: 42, date: '2026-09-05', name: 'Norway Open 2026', country: 'NOR', city: 'Sandnes (NOR)', level: 4 };
  const players = Array.from({ length: 9 }, (_, index) => ({
    id: index + 1,
    name: `Player ${index + 1}`,
    birthYear: 2014,
    isWoman: true,
    results: [{ tournamentId: 42, date: tournament.date, name: tournament.name, country: 'NOR', position: index + 1, ithfPoints: 1 }],
  }));
  const data = buildQualificationData({
    players,
    tournaments: [tournament],
    sharedThirdIds: new Set(),
    generatedAt: '2026-08-12T03:00:00.000Z',
  });
  assert.equal(validateQualificationData(data), true);
  const open = data.categories.find((category) => category.id === 'open');
  assert.equal(open.players[0].points, 600);
  assert.equal(open.players[7].qualified, true);
  assert.equal(open.players[8].qualified, false);
  const kids = data.categories.find((category) => category.id === 'kids');
  assert.equal(kids.players[8].qualified, true);
});

test('includes only levels 2, 3 and 4 and applies the NBHF guarantee to them', () => {
  const tournaments = [2, 3, 4, 5].map((level) => ({
    id: 40 + level,
    date: `2026-0${level}-01`,
    name: `Norway Level ${level} Open`,
    country: 'NOR',
    city: 'Oslo (NOR)',
    level,
  }));
  const player = {
    id: 10,
    name: 'Level Test Player',
    birthYear: 1990,
    isWoman: false,
    results: tournaments.map((tournament) => ({
      tournamentId: tournament.id,
      date: tournament.date,
      name: tournament.name,
      country: tournament.country,
      position: 1,
      ithfPoints: 1,
    })),
  };
  const data = buildQualificationData({
    players: [player],
    tournaments,
    sharedThirdIds: new Set(),
    generatedAt: '2026-08-12T03:00:00.000Z',
  });
  const open = data.categories.find((category) => category.id === 'open');
  const pointsByTournament = Object.fromEntries(
    open.players[0].results.map((result) => [result.tournamentId, result.points]),
  );
  assert.deepEqual(pointsByTournament, { 42: 600, 43: 600, 44: 600 });
});

test('rejects snapshots generated with obsolete qualification rules', () => {
  const data = buildQualificationData({
    players: [],
    tournaments: [],
    sharedThirdIds: new Set(),
    generatedAt: '2026-09-03T10:17:16.764Z',
  });
  assert.equal(data.version, QUALIFICATION_DATA_VERSION);
  assert.equal(validateQualificationData(data), true);
  assert.equal(validateQualificationData({ ...data, version: QUALIFICATION_DATA_VERSION - 1 }), false);
});

test('keeps at most three international results and excludes championships', () => {
  const tournaments = [
    ...Array.from({ length: 6 }, (_, index) => ({
      id: 100 + index,
      date: `2026-0${index + 1}-01`,
      name: `Norwegian Open ${index + 1}`,
      country: 'NOR',
      city: 'Oslo (NOR)',
      level: 4,
    })),
    ...Array.from({ length: 4 }, (_, index) => ({
      id: 200 + index,
      date: `2026-0${index + 1}-15`,
      name: `International Open ${index + 1}`,
      country: 'SWE',
      city: 'Malmo (SWE)',
      level: 4,
    })),
    {
      id: 300,
      date: '2026-06-20',
      name: 'European Championships 2026',
      country: 'SLO',
      city: 'Kranj (SLO)',
      level: 2,
    },
  ];
  const player = {
    id: 9,
    name: 'International Player',
    birthYear: 1990,
    isWoman: false,
    results: tournaments.map((tournament, index) => ({
      tournamentId: tournament.id,
      date: tournament.date,
      name: tournament.name,
      country: tournament.country,
      position: 1,
      ithfPoints: tournament.country === 'NOR' ? 1 : 1_000 - index,
    })),
  };
  const data = buildQualificationData({
    players: [player],
    tournaments,
    sharedThirdIds: new Set(),
    generatedAt: '2026-08-12T03:00:00.000Z',
  });
  const open = data.categories.find((category) => category.id === 'open');
  assert.equal(open.players[0].results.length, 8);
  assert.equal(open.players[0].results.filter((result) => result.type === 'ITHF').length, 3);
  assert.equal(open.players[0].results.some((result) => result.name.startsWith('European Championships')), false);
  assert.equal(validateQualificationData(data), true);
});
