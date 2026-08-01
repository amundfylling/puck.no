/** Weekly ITHF ranking refresh for registrations in upcoming tournaments. */
import { tournamentStatus } from './lib/dates.js';
import { getRanking } from './lib/ranking.js';
import { getTournamentConfig } from './lib/tournamentConfig.js';

const unranked = (name) => ({
  playerId: null,
  name,
  club: null,
  country: null,
  worldRanking: null,
  rankingPoints: 0,
  rankingValue: 0,
});

const ranked = (player) => ({
  playerId: player.id,
  name: player.name,
  club: player.club || null,
  country: player.nation || null,
  worldRanking: player.rank,
  rankingPoints: player.points,
  rankingValue: player.value,
});

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

function seedTeam(roster, playersPerTeam) {
  const sorted = [...roster].sort((a, b) =>
    b.rankingPoints - a.rankingPoints ||
    (a.worldRanking == null ? 1 : b.worldRanking == null ? -1 : a.worldRanking - b.worldRanking) ||
    a.name.localeCompare(b.name, 'no'),
  );
  return {
    roster: sorted,
    rankingPoints: sorted.slice(0, playersPerTeam).reduce((sum, player) => sum + player.rankingPoints, 0),
    topWorldRanking: sorted.find((player) => player.worldRanking != null)?.worldRanking ?? null,
  };
}

function rosterFor(row, byId) {
  const stored = parseArray(row.roster);
  const legacyIds = parseArray(row.player_ids) ?? [];
  const base = stored ?? (legacyIds.length
    ? legacyIds.map((playerId) => ({ playerId }))
    : legacyNames(row.name).map((name) => ({ playerId: null, name })));
  return base.map((player) => {
    if (Number.isInteger(player.playerId) && byId.has(player.playerId)) return ranked(byId.get(player.playerId));
    return {
      ...unranked(String(player.name ?? 'Ukjent spiller')),
      // Keep stale identity/data if an ID temporarily disappears from the feed.
      ...(Number.isInteger(player.playerId) ? player : {}),
    };
  });
}

export function isOsloRefreshTime(date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Oslo',
    weekday: 'short',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return parts.weekday === 'Wed' && parts.hour === '03';
}

export async function refreshUpcomingRankings(env, now = new Date()) {
  const config = await getTournamentConfig(env);
  const upcoming = Object.entries(config)
    .filter(([, tournament]) => tournamentStatus(tournament.date, now) === 'upcoming');
  if (upcoming.length === 0) return { tournaments: 0, registrations: 0, updated: 0 };

  const slugs = upcoming.map(([slug]) => slug);
  const placeholders = slugs.map(() => '?').join(', ');
  const { results } = await env.DB.prepare(
    `SELECT id, tournament_slug, type, name, country, club, world_ranking,
            ranking_points, ranking_value, player_id, player_ids, roster
     FROM registrations WHERE tournament_slug IN (${placeholders})`,
  ).bind(...slugs).all();
  const { byId } = await getRanking();
  const statements = [];

  for (const row of results) {
    const tournament = config[row.tournament_slug];
    if (row.type === 'team') {
      const seeded = seedTeam(rosterFor(row, byId), tournament.playersPerTeam);
      const playerIds = seeded.roster.flatMap((player) => Number.isInteger(player.playerId) ? [player.playerId] : []);
      statements.push(env.DB.prepare(
        `UPDATE registrations
         SET name = ?, country = NULL, club = NULL, world_ranking = ?, ranking_points = ?, ranking_value = NULL,
             player_ids = ?, roster = ?
         WHERE id = ?`,
      ).bind(
        seeded.roster.map((player) => player.name).join(' / '),
        seeded.topWorldRanking,
        seeded.rankingPoints,
        playerIds.length ? JSON.stringify(playerIds) : null,
        JSON.stringify(seeded.roster),
        row.id,
      ));
    } else if (Number.isInteger(row.player_id)) {
      const player = byId.get(row.player_id);
      if (!player) continue;
      statements.push(env.DB.prepare(
        `UPDATE registrations
         SET name = ?, country = ?, club = ?, world_ranking = ?, ranking_points = ?, ranking_value = ?
         WHERE id = ?`,
      ).bind(player.name, player.nation || null, player.club || null, player.rank, player.points, player.value, row.id));
    }
  }

  const refreshedAt = now.toISOString();
  for (const slug of slugs) {
    statements.push(env.DB.prepare(
      `INSERT INTO ranking_refreshes (tournament_slug, refreshed_at) VALUES (?, ?)
       ON CONFLICT(tournament_slug) DO UPDATE SET refreshed_at = excluded.refreshed_at`,
    ).bind(slug, refreshedAt));
  }
  if (statements.length) await env.DB.batch(statements);
  return { tournaments: slugs.length, registrations: results.length, updated: statements.length - slugs.length };
}
