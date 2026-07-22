/// <reference types="@cloudflare/workers-types" />
/**
 * GET /api/admin/registrations.csv?slug=… — full export incl. email/phone.
 *
 * Protected two ways (belt and braces):
 *  1. Application-level: the Cf-Access-Authenticated-User-Email header must be
 *     present (Cloudflare Access adds it after a successful login), else 403.
 *  2. Platform-level: Cloudflare Access in front of /api/admin/* (LAUNCH.md).
 * CSV is quoted and starts with a BOM so Excel shows Norwegian characters.
 */
import { KNOWN_SLUGS } from '../../lib/tournaments';

interface Env {
  DB: D1Database;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

const csvField = (v: unknown): string => `"${String(v ?? '').replaceAll('"', '""')}"`;

export const onRequestGet: PagesFunction<Env> = async (context) => {
  if (!context.request.headers.get('Cf-Access-Authenticated-User-Email')) {
    return json({ error: 'Ikke tilgang.' }, 403);
  }
  const slug = new URL(context.request.url).searchParams.get('slug') ?? '';
  if (!KNOWN_SLUGS.has(slug)) {
    return json({ error: 'Ukjent turnering.' }, 400);
  }
  const { results } = await context.env.DB.prepare(
    `SELECT id, tournament_slug, type, name, country, email, phone, world_ranking, created_at
     FROM registrations WHERE tournament_slug = ? ORDER BY id ASC`,
  )
    .bind(slug)
    .all();

  const header = 'id,tournament_slug,type,name,country,email,phone,world_ranking,created_at';
  const rows = results.map((r) =>
    [
      r.id,
      csvField(r.tournament_slug),
      csvField(r.type),
      csvField(r.name),
      csvField(r.country),
      csvField(r.email),
      csvField(r.phone),
      r.world_ranking ?? '',
      csvField(r.created_at),
    ].join(','),
  );
  const csv = '\uFEFF' + [header, ...rows].join('\r\n') + '\r\n'; // leading ﻿ (BOM) for Excel
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="pameldinger-${slug}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
};

export const onRequest: PagesFunction<Env> = async () =>
  json({ error: 'Method not allowed' }, 405);
