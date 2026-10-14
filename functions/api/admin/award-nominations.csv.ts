/// <reference types="@cloudflare/workers-types" />
/**
 * GET /api/admin/award-nominations.csv?year=2027 — Puck Awards nominations.
 *
 * Protected by Cloudflare Access at the edge and signed-assertion verification
 * in functions/api/admin/_middleware.ts. Defaults to the current award year.
 */
import awardsConfig from '../../../src/data/puck-awards.json';
import { adminIdentity } from '../../lib/admin-auth';
import { csvField } from '../../lib/csv';

type Env = CloudflareEnv;

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
  if (!adminIdentity(context.data)) return json({ error: 'Ikke tilgang.' }, 403);
  const param = new URL(context.request.url).searchParams.get('year');
  const year = param == null ? awardsConfig.year : Number(param);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return json({ error: 'Ugyldig år.' }, 400);
  }
  const names = new Map(awardsConfig.categories.map((c) => [c.id, c.name]));
  const { results } = await context.env.DB.prepare(
    `SELECT id, category, nominee, reason, nominator, submission_id, created_at
     FROM award_nominations WHERE award_year = ? ORDER BY category ASC, id ASC`,
  )
    .bind(year)
    .all();

  const header = 'id,kategori,nominert,begrunnelse,nominert_av,innsending,created_at';
  const rows = results.map((r) => [
    r.id,
    csvField(names.get(String(r.category)) ?? r.category),
    csvField(r.nominee),
    csvField(r.reason),
    csvField(r.nominator),
    csvField(r.submission_id),
    csvField(r.created_at),
  ].join(','));
  const csv = '﻿' + [header, ...rows].join('\r\n') + '\r\n';
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="puck-awards-${year}.csv"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
};

export const onRequest: PagesFunction<Env> = async () =>
  json({ error: 'Method not allowed' }, 405);
