/**
 * Norwegian NBL statistics: the all-time medal table ("adelskalender") and
 * consecutive-tournament streaks, built from the public ITHF series page
 * (serial.aspx?ID=220001) and the per-tournament result tables.
 *
 * A streak counts consecutive tournaments in the Norwegian NBL series as
 * listed by ITHF, in date order. Missing any NBL tournament resets it.
 */
import { decodeHtml, extractElementById, parseIthfDate, textFromHtml } from './qualification.mjs';

export const NBL_STATS_VERSION = 1;
export const NBL_SERIAL_ID = 220001;
export const STREAK_LEADERBOARD_SIZE = 25;

function extractRows(fragment) {
  return [...String(fragment).matchAll(/<tr\b[^>]*>([\s\S]*?)(?=<tr\b|<\/table>|$)/gi)].map((match) => match[1]);
}

function extractCells(rowHtml) {
  return [...String(rowHtml).matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1]);
}

function linkId(value, type) {
  const match = String(value).match(new RegExp(`href=["'][^"']*${type}\\.aspx\\?[^"']*id=(\\d+)`, 'i'));
  return match ? Number(match[1]) : null;
}

function cleanName(value) {
  return textFromHtml(value).replace(/^\*\s*/, '');
}

/** Medal table from the "Medallists" block (LabWinners) of the series page. */
export function parseSerialMedals(html) {
  const fragment = extractElementById(html, 'LabWinners');
  const medals = [];
  for (const row of extractRows(fragment)) {
    const cells = extractCells(row);
    if (cells.length !== 5) continue;
    const playerId = linkId(cells[4], 'player');
    const [gold, silver, bronze] = cells.slice(1, 4).map((cell) => Number.parseInt(textFromHtml(cell), 10));
    if (!playerId || ![gold, silver, bronze].every(Number.isInteger)) continue;
    medals.push({ playerId, name: cleanName(cells[4]), gold, silver, bronze });
  }
  return medals;
}

/** Past tournaments (LabPast) of the series page, oldest first. */
export function parseSerialTournaments(html) {
  const fragment = extractElementById(html, 'LabPast');
  const tournaments = [];
  for (const row of extractRows(fragment)) {
    const cells = extractCells(row);
    if (cells.length !== 6) continue;
    const date = parseIthfDate(textFromHtml(cells[0]));
    const id = linkId(cells[1], 'tournament');
    const playerCount = Number.parseInt(textFromHtml(cells[5]), 10);
    if (!date || !id) continue;
    tournaments.push({
      id,
      date,
      name: cleanName(cells[1]),
      city: textFromHtml(cells[3]),
      playerCount: Number.isInteger(playerCount) ? playerCount : null,
    });
  }
  return sortTournaments(tournaments);
}

/** Participants (ITHF player ids + names) from a tournament result table. */
export function parseTournamentPlayers(html) {
  const fragment = extractElementById(html, 'LabTable');
  const players = [];
  const seen = new Set();
  for (const row of extractRows(fragment)) {
    const cells = extractCells(row);
    if (cells.length < 4) continue;
    const cell = cells.find((value) => linkId(value, 'player'));
    const id = cell ? linkId(cell, 'player') : null;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    players.push({ id, name: cleanName(cell) });
  }
  return players;
}

export function sortTournaments(tournaments) {
  return [...tournaments].sort((a, b) => (a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1));
}

function tournamentRef(tournament) {
  return { id: tournament.id, name: tournament.name, date: tournament.date };
}

/**
 * Walk the series in date order and track every player's run of
 * consecutive tournaments. Returns current streaks (players who played the
 * latest tournament) and each player's longest-ever streak.
 */
export function computeStreaks(tournaments, names = {}) {
  const ordered = sortTournaments(tournaments);
  const running = new Map(); // playerId -> { length, startIndex }
  const best = new Map(); // playerId -> { length, startIndex, endIndex }

  ordered.forEach((tournament, index) => {
    const present = new Set(tournament.players);
    for (const playerId of [...running.keys()]) {
      if (!present.has(playerId)) running.delete(playerId);
    }
    for (const playerId of present) {
      const run = running.get(playerId) ?? { length: 0, startIndex: index };
      run.length += 1;
      running.set(playerId, run);
      const record = best.get(playerId);
      // ">=" keeps the most recent run when a player equals their own record.
      if (!record || run.length >= record.length) {
        best.set(playerId, { length: run.length, startIndex: run.startIndex, endIndex: index });
      }
    }
  });

  const lastIndex = ordered.length - 1;
  const name = (playerId) => names[playerId] ?? String(playerId);
  const byLength = (a, b) => b.streak - a.streak || a.name.localeCompare(b.name, 'nb');

  const current = [...running.entries()]
    .map(([playerId, run]) => ({
      playerId,
      name: name(playerId),
      streak: run.length,
      from: tournamentRef(ordered[run.startIndex]),
    }))
    .sort(byLength);

  const longest = [...best.entries()]
    .map(([playerId, record]) => ({
      playerId,
      name: name(playerId),
      streak: record.length,
      from: tournamentRef(ordered[record.startIndex]),
      to: tournamentRef(ordered[record.endIndex]),
      active: record.endIndex === lastIndex && running.get(playerId)?.length === record.length,
    }))
    .sort(byLength);

  return { current, longest };
}

/** Standard competition ranking ("1, 2, 2, 4") on a numeric key. */
function withRanks(rows, key) {
  let previous = null;
  let rank = 0;
  return rows.map((row, index) => {
    const value = key(row);
    if (value !== previous) rank = index + 1;
    previous = value;
    return { rank, ...row };
  });
}

export function buildNblStats({ medals, tournaments, generatedAt }) {
  const ordered = sortTournaments(tournaments);
  const names = {};
  for (const tournament of ordered) {
    for (const player of tournament.players) names[player.id] = player.name;
  }
  for (const medal of medals) names[medal.playerId] ??= medal.name;

  const medalRows = medals
    .map((medal) => ({ ...medal, total: medal.gold + medal.silver + medal.bronze }))
    .sort((a, b) => b.gold - a.gold || b.silver - a.silver || b.bronze - a.bronze || a.name.localeCompare(b.name, 'nb'));

  const compact = ordered.map((tournament) => ({
    id: tournament.id,
    date: tournament.date,
    name: tournament.name,
    city: tournament.city,
    players: tournament.players.map((player) => player.id),
  }));
  const { current, longest } = computeStreaks(compact, names);
  const latest = compact.at(-1);

  return {
    version: NBL_STATS_VERSION,
    generatedAt,
    series: { id: NBL_SERIAL_ID, name: 'Norwegian NBL' },
    latestTournament: latest ? { id: latest.id, name: latest.name, date: latest.date, players: latest.players.length } : null,
    tournamentCount: compact.length,
    medals: withRanks(medalRows, (row) => `${row.gold}-${row.silver}-${row.bronze}`),
    currentStreaks: withRanks(current, (row) => row.streak),
    longestStreaks: withRanks(longest.slice(0, STREAK_LEADERBOARD_SIZE * 2), (row) => row.streak)
      .filter((row) => row.rank <= STREAK_LEADERBOARD_SIZE),
    // Cache of participant lists so later builds only fetch new tournaments.
    tournaments: compact,
    players: names,
  };
}

/** Turn a stored snapshot's compact tournament cache back into parser shape. */
export function cachedTournaments(snapshot) {
  if (!snapshot?.tournaments) return new Map();
  const names = snapshot.players ?? {};
  return new Map(snapshot.tournaments.map((tournament) => [tournament.id, {
    ...tournament,
    players: tournament.players.map((id) => ({ id, name: names[id] ?? String(id) })),
  }]));
}

export function validateNblStats(data) {
  if (!data || data.version !== NBL_STATS_VERSION) return false;
  if (typeof data.generatedAt !== 'string' || Number.isNaN(Date.parse(data.generatedAt))) return false;
  if (!Array.isArray(data.medals) || data.medals.length < 20) return false;
  if (!Array.isArray(data.tournaments) || data.tournaments.length < 50) return false;
  if (!Array.isArray(data.currentStreaks) || !Array.isArray(data.longestStreaks)) return false;
  if (data.longestStreaks.length === 0 || data.currentStreaks.length === 0) return false;
  const medalOk = data.medals.every((row) =>
    Number.isInteger(row.playerId) && typeof row.name === 'string' &&
    [row.gold, row.silver, row.bronze, row.total, row.rank].every(Number.isInteger));
  const tournamentsOk = data.tournaments.every((row) =>
    Number.isInteger(row.id) && /^\d{4}-\d{2}-\d{2}$/.test(row.date) &&
    Array.isArray(row.players) && row.players.every(Number.isInteger));
  return medalOk && tournamentsOk;
}

export { decodeHtml };
