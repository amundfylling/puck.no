/// <reference types="@cloudflare/workers-types" />
/**
 * GET /api/admin/registrations.json?slug=… — registration rows for the admin
 * participant view (searchable/sortable table in the portal).
 *
 * Deliberately NO email/phone: contact details stay in the Access-protected
 * CSV export (registrations.csv). Everything here is a public field (the
 * participant lists show name/country/world_ranking) plus admin metadata
 * (id, type, created_at).
 *
 * Protected two ways (belt and braces), like registrations.csv:
 *  1. Application-level: the Cf-Access-Authenticated-User-Email header must
 *     be present (Cloudflare Access adds it after a successful login).
 *  2. Platform-level: Cloudflare Access in front of /api/admin/* (LAUNCH.md).
 */
import { KNOWN_SLUGS } from '../../lib/tournaments';

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
    `SELECT id, type, name, country, world_ranking, created_at
     FROM registrations WHERE tournament_slug = ? ORDER BY created_at ASC, id ASC`,
  )
    .bind(slug)
    .all();
  return json(results);
};

export const onRequest: PagesFunction<Env> = async () =>
  json({ error: 'Method not allowed' }, 405);
