/// <reference types="@cloudflare/workers-types" />
/**
 * GET /api/admin/registrations.json?slug=… — registration rows for the admin
 * participant view (searchable/sortable table in the portal).
 *
 * Includes contact details, structured rosters and custom answers because
 * administrators can add/edit/delete rows here. The route is Access-protected.
 *
 * Protected two ways (belt and braces), like registrations.csv:
 *  1. Application-level: the Cf-Access-Authenticated-User-Email header must
 *     be present (Cloudflare Access adds it after a successful login).
 *  2. Platform-level: Cloudflare Access in front of /api/admin/* (LAUNCH.md).
 */
import { KNOWN_SLUGS } from '../../lib/tournaments';
import { parseAnswers, parseRoster } from '../../lib/registration';

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
  if (!context.request.headers.get('Cf-Access-Authenticated-User-Email')) {
    return json({ error: 'Ikke tilgang.' }, 403);
  }
  const slug = new URL(context.request.url).searchParams.get('slug') ?? '';
  if (!KNOWN_SLUGS.has(slug)) {
    return json({ error: 'Ukjent turnering.' }, 400);
  }
  const { results } = await context.env.DB.prepare(
    `SELECT id, type, name, country, club, email, phone, world_ranking,
            ranking_points, ranking_value, player_id, roster, answers, created_at
     FROM registrations WHERE tournament_slug = ? ORDER BY created_at ASC, id ASC`,
  )
    .bind(slug)
    .all();
  return json(results.map((row) => ({
    ...row,
    roster: row.type === 'team' ? parseRoster(row.roster, String(row.name)) : null,
    answers: parseAnswers(row.answers),
  })));
};

export const onRequest: PagesFunction<Env> = async () =>
  json({ error: 'Method not allowed' }, 405);
