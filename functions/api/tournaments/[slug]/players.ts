/// <reference types="@cloudflare/workers-types" />
/**
 * GET /api/tournaments/{slug}/players — public participant list.
 *
 * Returns public player/team seed data — never email, phone or custom answers.
 * Points sort descending; equal team totals use the best player's world rank.
 */
import { KNOWN_SLUGS, TOURNAMENTS } from '../../../lib/tournaments';
import { parseRoster } from '../../../lib/registration';
import { calculatePlacementPoints } from '../../../lib/ranking-points';

interface Env {
  DB: D1Database;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
    },
  });
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const slug = String(context.params.slug);
  if (!KNOWN_SLUGS.has(slug)) {
    return json({ error: 'Ukjent turnering.' }, 404);
  }
  const { results } = await context.env.DB.prepare(
    `SELECT type, name, country, club, world_ranking, ranking_points,
            ranking_value, player_id, roster
     FROM registrations
     WHERE tournament_slug = ?
     ORDER BY ranking_points IS NULL ASC, ranking_points DESC,
              world_ranking IS NULL ASC, world_ranking ASC,
              name COLLATE NOCASE ASC`,
  )
    .bind(slug)
    .all();
  const refresh = await context.env.DB.prepare(
    'SELECT refreshed_at FROM ranking_refreshes WHERE tournament_slug = ?',
  ).bind(slug).first<{ refreshed_at: string }>();
  const participants = results.map((row) => {
    const roster = row.type === 'team'
      ? parseRoster(row.roster, String(row.name)).map(({ nameKey: _internalKey, ...player }) => player)
      : null;
    return {
      type: row.type,
      name: row.name,
      country: row.country ?? null,
      club: row.club ?? null,
      world_ranking: row.world_ranking ?? null,
      ranking_points: row.ranking_points ?? (row.type === 'team' ? 0 : null),
      roster,
    };
  });
  const tournament = TOURNAMENTS[slug];
  const playerValues = results.map((row) =>
    tournament.playersPerTeam == null ? Number(row.ranking_value ?? 0) : 0,
  );
  const rankingValuesComplete = !results.some((row) =>
    row.type === 'player' && row.player_id != null && row.ranking_value == null,
  );
  const placementPoints = tournament.rankingLevel == null
    ? null
    : calculatePlacementPoints(tournament.rankingLevel, playerValues)
      .map(({ placement, points }) => ({ placement, points }));
  return json({
    participants,
    playersPerTeam: tournament.playersPerTeam,
    rankingRefreshedAt: refresh?.refreshed_at ?? null,
    rankingLevel: tournament.rankingLevel,
    rankingAlgorithm: tournament.rankingLevel == null ? null : 'ithf-wr-2020',
    rankingValuesComplete,
    placementPoints,
  });
};

export const onRequest: PagesFunction<Env> = async () =>
  json({ error: 'Method not allowed' }, 405);
