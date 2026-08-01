/// <reference types="@cloudflare/workers-types" />
/**
 * GET /api/admin/registrations.csv?slug=… — full export incl. email/phone.
 *
 * Protected by Cloudflare Access at the edge and signed-assertion verification
 * in functions/api/admin/_middleware.ts.
 * CSV is quoted and starts with a BOM so Excel shows Norwegian characters.
 */
import { adminIdentity } from '../../lib/admin-auth';
import { csvField } from '../../lib/csv';
import { KNOWN_SLUGS } from '../../lib/tournaments';
import { parseAnswers } from '../../lib/registration';

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
  if (!adminIdentity(context.data)) return json({ error: 'Ikke tilgang.' }, 403);
  const slug = new URL(context.request.url).searchParams.get('slug') ?? '';
  if (!KNOWN_SLUGS.has(slug)) {
    return json({ error: 'Ukjent turnering.' }, 400);
  }
  const { results } = await context.env.DB.prepare(
    `SELECT id, tournament_slug, type, name, country, club, email, phone,
            world_ranking, ranking_points, ranking_value, roster, answers, created_at
     FROM registrations WHERE tournament_slug = ? ORDER BY id ASC`,
  )
    .bind(slug)
    .all();

  const questionIds: string[] = [];
  for (const row of results) {
    for (const answer of parseAnswers(row.answers)) {
      if (!questionIds.includes(answer.questionId)) questionIds.push(answer.questionId);
    }
  }
  const header = [
    'id', 'tournament_slug', 'type', 'name', 'country', 'club', 'email', 'phone',
    'world_ranking', 'ranking_points', 'ranking_value', 'roster_json',
    ...questionIds.map((id) => `question_${id}`),
    'created_at',
  ].join(',');
  const rows = results.map((r) => {
    const answers = new Map(parseAnswers(r.answers).map((answer) => [answer.questionId, answer.labelNo]));
    return [
      r.id,
      csvField(r.tournament_slug),
      csvField(r.type),
      csvField(r.name),
      csvField(r.country),
      csvField(r.club),
      csvField(r.email),
      csvField(r.phone),
      r.world_ranking ?? '',
      r.ranking_points ?? '',
      r.ranking_value ?? '',
      csvField(r.roster),
      ...questionIds.map((id) => csvField(answers.get(id) ?? '')),
      csvField(r.created_at),
    ].join(',');
  });
  const csv = '\uFEFF' + [header, ...rows].join('\r\n') + '\r\n'; // leading ﻿ (BOM) for Excel
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="pameldinger-${slug}.csv"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    },
  });
};

export const onRequest: PagesFunction<Env> = async () =>
  json({ error: 'Method not allowed' }, 405);
