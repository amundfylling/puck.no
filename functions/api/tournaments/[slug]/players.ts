/// <reference types="@cloudflare/workers-types" />
/**
 * GET /api/tournaments/{slug}/players — public participant list.
 *
 * Returns ONLY { name, country, world_ranking } per row — never email/phone.
 * Ordered by world_ranking (NULLS LAST), then name.
 */
import { KNOWN_SLUGS } from '../../../lib/slugs';

interface Env {
  DB: D1Database;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const slug = String(context.params.slug);
  if (!KNOWN_SLUGS.has(slug)) {
    return json({ error: 'Ukjent turnering.' }, 404);
  }
  const { results } = await context.env.DB.prepare(
    `SELECT name, country, world_ranking FROM registrations
     WHERE tournament_slug = ?
     ORDER BY world_ranking IS NULL ASC, world_ranking ASC, name COLLATE NOCASE ASC`,
  )
    .bind(slug)
    .all();
  const players = results.map((r) => ({
    name: r.name,
    country: r.country ?? null,
    world_ranking: r.world_ranking ?? null,
  }));
  return json(players);
};

export const onRequest: PagesFunction<Env> = async () =>
  json({ error: 'Method not allowed' }, 405);
