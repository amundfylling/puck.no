import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildNblStats,
  cachedTournaments,
  computeStreaks,
  parseSerialMedals,
  parseSerialTournaments,
  parseTournamentPlayers,
} from './nbl-stats.mjs';

test('parses the medal table and past tournaments from the ITHF series page', () => {
  // Mirrors ITHF's markup, including the unclosed <tr> rows in the medal block.
  const html = `<span id="LabWinners"><table><tr><td colspan="10" class="head">Medallists</td></tr><tr><td width="50%" colspan="5"><table>
    <td class="head">Pos.</td><td class="head">G</td><td class="head">S</td><td class="head">B</td><td class="head">Name</td>
    <tr><td class="Norm">1.</td><td class="Norm">34</td><td class="Norm">15</td><td class="Norm">8</td><td class="Norm"><a href="player.aspx?id=220169">Tore Lie</a></td><tr>
    <tr><td class="Norm">2.</td><td class="Norm">0</td><td class="Norm">2</td><td class="Norm">3</td><td class="Norm"><a href="player.aspx?id=7">Arve &quot;Lord&quot; O</a></td><tr></table></td></tr></table><br></span>
    <span id="LabPast"><table><tr><td valign="top"><table><tr><td class="head">Date</td><td class="Head">Tournament</td><td class="head">Web</td><td class="head">City</td><td class="head">Winner</td><td class="head">Players</td></tr>
    <tr><td class="Norm">17.10.2026</td><td class="NorM"><a href="tournament.aspx?id=36414">Krohnengen Open 2026</a></td><td class="Norm">&nbsp;</td><td class="Norm">Bergen</td><td class="Norm"><a href="player.aspx?id=1">A</a></td><td class="Norm">27</td></tr>
    <tr><td class="Norm">01.09.1999</td><td class="NorM"><a href="tournament.aspx?id=10">Kolvereid Open 1999</a></td><td class="Norm">&nbsp;</td><td class="Norm">Kolvereid</td><td class="Norm"><a href="player.aspx?id=1">A</a></td><td class="Norm">17</td></tr>
    </table></td></tr></table></span>`;

  assert.deepEqual(parseSerialMedals(html), [
    { playerId: 220169, name: 'Tore Lie', gold: 34, silver: 15, bronze: 8 },
    { playerId: 7, name: 'Arve "Lord" O', gold: 0, silver: 2, bronze: 3 },
  ]);
  assert.deepEqual(parseSerialTournaments(html), [
    { id: 10, date: '1999-09-01', name: 'Kolvereid Open 1999', city: 'Kolvereid', playerCount: 17 },
    { id: 36414, date: '2026-10-17', name: 'Krohnengen Open 2026', city: 'Bergen', playerCount: 27 },
  ]);
});

test('parses participants from a tournament result table', () => {
  const html = `<table id="LabTable"><tr><td class="playerB">1.</td><td>82.</td><td>-</td><td class="player"><a href="player.aspx?id=660869">Amund Risa Fylling</a></td><td><a href="club.aspx?id=1">Club</a></td><td>Norway</td><td>592</td></tr>
    <tr><td>3.</td><td>350.</td><td>+30</td><td><a href="player.aspx?id=657858">Hans Christian Lonne</a></td><td><a href="club.aspx?id=2">C</a></td><td>Norway</td><td>479</td></tr></table>`;
  assert.deepEqual(parseTournamentPlayers(html), [
    { id: 660869, name: 'Amund Risa Fylling' },
    { id: 657858, name: 'Hans Christian Lonne' },
  ]);
});

test('a missed tournament resets the streak; records keep their period', () => {
  const tournaments = [
    { id: 1, date: '2024-01-01', name: 'T1', players: [1, 2, 3] },
    { id: 2, date: '2024-02-01', name: 'T2', players: [1, 2, 3] },
    { id: 3, date: '2024-03-01', name: 'T3', players: [1, 3] },
    { id: 4, date: '2024-04-01', name: 'T4', players: [1, 3] },
    { id: 5, date: '2024-05-01', name: 'T5', players: [2, 3] },
    // Same date: ordered by ITHF id.
    { id: 7, date: '2024-06-01', name: 'T7', players: [2, 3] },
    { id: 6, date: '2024-06-01', name: 'T6', players: [2] },
  ];
  const { current, longest } = computeStreaks(tournaments, { 1: 'Ada', 2: 'Bo', 3: 'Cy' });

  assert.deepEqual(current.map((row) => [row.name, row.streak, row.from.name]), [
    ['Bo', 3, 'T5'],
    ['Cy', 1, 'T7'],
  ]);
  const byName = Object.fromEntries(longest.map((row) => [row.name, row]));
  assert.equal(byName.Cy.streak, 5);
  assert.equal(byName.Cy.from.name, 'T1');
  assert.equal(byName.Cy.to.name, 'T5');
  assert.equal(byName.Cy.active, false);
  assert.equal(byName.Ada.streak, 4);
  assert.equal(byName.Bo.streak, 3);
  assert.equal(byName.Bo.active, true);
});

test('builds ranked output and round-trips the tournament cache', () => {
  const tournaments = [
    { id: 1, date: '2024-01-01', name: 'T1', city: 'Oslo', players: [{ id: 1, name: 'Ada' }, { id: 2, name: 'Bo' }] },
    { id: 2, date: '2024-02-01', name: 'T2', city: 'Bergen', players: [{ id: 1, name: 'Ada' }, { id: 2, name: 'Bo' }] },
  ];
  const medals = [
    { playerId: 2, name: 'Bo', gold: 1, silver: 1, bronze: 0 },
    { playerId: 1, name: 'Ada', gold: 1, silver: 1, bronze: 0 },
    { playerId: 3, name: 'Cy', gold: 0, silver: 0, bronze: 2 },
  ];
  const data = buildNblStats({ medals, tournaments, generatedAt: '2026-11-20T00:00:00.000Z' });

  assert.deepEqual(data.medals.map((row) => [row.rank, row.name, row.total]), [[1, 'Ada', 2], [1, 'Bo', 2], [3, 'Cy', 2]]);
  assert.deepEqual(data.currentStreaks.map((row) => [row.rank, row.name, row.streak]), [[1, 'Ada', 2], [1, 'Bo', 2]]);
  assert.deepEqual(data.latestTournament, { id: 2, name: 'T2', date: '2024-02-01', players: 2 });
  assert.deepEqual(cachedTournaments(data).get(1).players, tournaments[0].players);
});
