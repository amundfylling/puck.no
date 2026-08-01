#!/usr/bin/env node
/**
 * One-time D1 backfill from the live ITHF ranking.
 *
 * Reads only public registration identity fields (never email/phone), updates
 * ranked individuals, and converts legacy team-name rosters when names match
 * the ranking exactly. Dry-run is the default.
 *
 * Usage:
 *   node scripts/backfill-ranking-values.mjs --remote
 *   node scripts/backfill-ranking-values.mjs --remote --apply
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readResponseTextLimited } from './lib/bounded-response.mjs';

const RANKING_URL = 'https://stiga.trefik.cz/ithf/ranking/ranking.txt';
const DATABASE = 'puck-no';
const MAX_RANKING_BYTES = 5 * 1024 * 1024;
const args = new Set(process.argv.slice(2));
const location = args.has('--remote') ? '--remote' : args.has('--local') ? '--local' : null;
const apply = args.has('--apply');

if (!location || (args.has('--remote') && args.has('--local'))) {
  console.error('Choose exactly one database: --remote or --local. Dry-run is the default; add --apply to write.');
  process.exit(1);
}

const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function wrangler(extraArgs, { parseJson = true } = {}) {
  const result = spawnSync(npx, ['wrangler', 'd1', 'execute', DATABASE, location, '--json', ...extraArgs], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || `wrangler exited ${result.status}`);
  }
  return parseJson ? JSON.parse(result.stdout) : result.stdout;
}

function parseRanking(tsv) {
  const players = [];
  for (const line of tsv.split(/\r?\n/).slice(2)) {
    if (!line.trim()) continue;
    const [rank, id, name, club, nation, points, value] = line.split('\t');
    const player = {
      rank: Number(rank), id: Number(id), name, club: club ?? '', nation: nation ?? '',
      points: Number(points), value: Number(value),
    };
    if (
      Number.isInteger(player.rank) && player.rank > 0 &&
      Number.isInteger(player.id) && player.id > 0 &&
      name && points?.trim() !== '' && Number.isFinite(player.points) && player.points >= 0 &&
      value?.trim() !== '' && Number.isFinite(player.value) && player.value >= 0
    ) players.push(player);
  }
  if (players.length < 1000) throw new Error(`ITHF feed contained only ${players.length} valid players; refusing to continue.`);
  return players;
}

const normalizeName = (value) => String(value ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('nb-NO');
const sqlText = (value) => value == null ? 'NULL' : `'${String(value).replaceAll("'", "''")}'`;
const sqlNumber = (value) => Number.isFinite(value) ? String(value) : 'NULL';

function parseArray(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function legacyNames(name) {
  return String(name ?? '').split(/\s+\/\s+|\s*,\s*/).map((part) => part.trim()).filter(Boolean);
}

const rankingResponse = await fetch(RANKING_URL, { signal: AbortSignal.timeout(20_000) });
if (!rankingResponse.ok) throw new Error(`ITHF ranking returned HTTP ${rankingResponse.status}.`);
const ranking = parseRanking(await readResponseTextLimited(rankingResponse, MAX_RANKING_BYTES));
const byId = new Map(ranking.map((player) => [player.id, player]));
const byName = new Map();
for (const player of ranking) {
  const key = normalizeName(player.name);
  const matches = byName.get(key) ?? [];
  matches.push(player);
  byName.set(key, matches);
}

const config = JSON.parse(
  await (await import('node:fs/promises')).readFile(new URL('../functions/lib/tournament-config.json', import.meta.url), 'utf8'),
);
const query = `SELECT id, tournament_slug, type, name, player_id, player_ids, roster
  FROM registrations
  WHERE (type = 'player' AND player_id IS NOT NULL) OR type = 'team'
  ORDER BY id`;
const queryResult = wrangler(['--command', query]);
const rows = queryResult.flatMap((batch) => batch.results ?? []);
const statements = [];
const touchedSlugs = new Set();
let individuals = 0;
let missingPlayerIds = 0;
let teams = 0;
let linkedTeamPlayers = 0;
let unlinkedTeamPlayers = 0;

for (const row of rows) {
  if (row.type === 'player') {
    const player = byId.get(Number(row.player_id));
    if (!player) {
      missingPlayerIds += 1;
      continue;
    }
    statements.push(`UPDATE registrations SET
      name = ${sqlText(player.name)}, club = ${sqlText(player.club || null)}, country = ${sqlText(player.nation || null)},
      world_ranking = ${player.rank}, ranking_points = ${sqlNumber(player.points)}, ranking_value = ${sqlNumber(player.value)}
      WHERE id = ${Number(row.id)} AND type = 'player' AND player_id = ${player.id};`);
    individuals += 1;
    touchedSlugs.add(row.tournament_slug);
    continue;
  }

  const tournament = config[row.tournament_slug];
  if (!tournament || !Number.isInteger(tournament.playersPerTeam)) continue;
  const storedRoster = parseArray(row.roster);
  const storedIds = parseArray(row.player_ids);
  const source = storedRoster ?? (storedIds?.map((playerId) => ({ playerId })) ?? legacyNames(row.name).map((name) => ({ name })));
  const roster = source.map((entry) => {
    const idMatch = Number.isInteger(entry.playerId) ? byId.get(entry.playerId) : null;
    const exactMatches = idMatch ? [] : byName.get(normalizeName(entry.name)) ?? [];
    const player = idMatch ?? (exactMatches.length === 1 ? exactMatches[0] : null);
    if (!player) {
      unlinkedTeamPlayers += 1;
      return {
        playerId: null, name: String(entry.name ?? 'Ukjent spiller'),
        nameKey: normalizeName(entry.name ?? 'Ukjent spiller'), club: null, country: null,
        worldRanking: null, rankingPoints: 0, rankingValue: 0,
      };
    }
    linkedTeamPlayers += 1;
    return {
      playerId: player.id, name: player.name, club: player.club || null, country: player.nation || null,
      worldRanking: player.rank, rankingPoints: player.points, rankingValue: player.value,
    };
  }).sort((a, b) =>
    b.rankingPoints - a.rankingPoints ||
    (a.worldRanking == null ? 1 : b.worldRanking == null ? -1 : a.worldRanking - b.worldRanking) ||
    a.name.localeCompare(b.name, 'no'),
  );
  const playerIds = roster.flatMap((player) => player.playerId == null ? [] : [player.playerId]);
  const rankingPoints = roster.slice(0, tournament.playersPerTeam)
    .reduce((sum, player) => sum + player.rankingPoints, 0);
  const topWorldRanking = roster.find((player) => player.worldRanking != null)?.worldRanking ?? null;
  statements.push(`UPDATE registrations SET
    name = ${sqlText(roster.map((player) => player.name).join(' / '))}, country = NULL, club = NULL,
    world_ranking = ${sqlNumber(topWorldRanking)}, ranking_points = ${sqlNumber(rankingPoints)}, ranking_value = NULL,
    player_ids = ${playerIds.length ? sqlText(JSON.stringify(playerIds)) : 'NULL'}, roster = ${sqlText(JSON.stringify(roster))}
    WHERE id = ${Number(row.id)} AND type = 'team';`);
  teams += 1;
  touchedSlugs.add(row.tournament_slug);
}

const refreshedAt = new Date().toISOString();
for (const slug of touchedSlugs) {
  statements.push(`INSERT INTO ranking_refreshes (tournament_slug, refreshed_at)
    VALUES (${sqlText(slug)}, ${sqlText(refreshedAt)})
    ON CONFLICT(tournament_slug) DO UPDATE SET refreshed_at = excluded.refreshed_at;`);
}

console.log(`ITHF feed: ${ranking.length} players`);
console.log(`Ranked individuals ready: ${individuals}; missing IDs: ${missingPlayerIds}`);
console.log(`Teams ready: ${teams}; linked roster players: ${linkedTeamPlayers}; unlinked roster players: ${unlinkedTeamPlayers}`);
console.log(`Tournament refresh timestamps: ${touchedSlugs.size}`);

if (!apply) {
  console.log(`Dry run only. Re-run with ${location} --apply to execute ${statements.length} statements.`);
  process.exit(0);
}
if (statements.length === 0) throw new Error('No matching registrations found; nothing was changed.');

const tempDir = mkdtempSync(join(tmpdir(), 'puck-ranking-backfill-'));
const sqlFile = join(tempDir, 'backfill.sql');
try {
  writeFileSync(sqlFile, statements.join('\n') + '\n', { mode: 0o600 });
  // Wrangler prints upload progress before its result for --file even with
  // --json, so success is determined by the process exit code here.
  wrangler(['--file', sqlFile], { parseJson: false });
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
console.log(`Applied ${statements.length} statements successfully.`);
