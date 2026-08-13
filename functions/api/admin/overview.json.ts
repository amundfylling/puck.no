/// <reference types="@cloudflare/workers-types" />
/**
 * GET /api/admin/overview.json — dashboard data for the admin portal.
 *
 * Per known tournament: registration counts (players/teams), the latest
 * registration timestamp and the registrationOpen flag (build-time config).
 * Plus site-wide totals and the most recent registrations (public fields
 * only — name is shown on the public participant lists anyway).
 *
 * Protected by Cloudflare Access at the edge and signed-assertion verification
 * in functions/api/admin/_middleware.ts.
 */
import { adminIdentity } from '../../lib/admin-auth';
import { KNOWN_SLUGS, TOURNAMENTS } from '../../lib/tournaments';

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

interface CountRow {
  slug: string;
  type: string;
  n: number;
  last: string | null;
}

interface RecentRow {
  tournament_slug: string;
  type: string;
  name: string;
  created_at: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  if (!adminIdentity(context.data)) return json({ error: 'Ikke tilgang.' }, 403);

  const counts = await context.env.DB.prepare(
    `SELECT tournament_slug AS slug, type, COUNT(*) AS n, MAX(created_at) AS last
     FROM registrations GROUP BY tournament_slug, type`,
  ).all<CountRow>();
  const recent7d = await context.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM registrations WHERE created_at >= datetime('now', '-7 days')`,
  ).all<{ n: number }>();
  // Fetch a few extra so rows from deleted/unknown slugs can be skipped.
  const recent = await context.env.DB.prepare(
    `SELECT tournament_slug, type, name, created_at FROM registrations
     ORDER BY created_at DESC, id DESC LIMIT 12`,
  ).all<RecentRow>();
  const runtimeClosed = new Set<string>();
  try {
    const runtimeSettings = await context.env.DB.prepare(
      'SELECT tournament_slug FROM tournament_settings WHERE registration_open = 0',
    ).all<{ tournament_slug: string }>();
    for (const row of runtimeSettings.results) runtimeClosed.add(row.tournament_slug);
  } catch (error) {
    if (!(error instanceof Error) || !/no such table.*tournament_settings/i.test(error.message)) throw error;
    console.warn('tournament_settings migration not applied; dashboard uses build-time flags');
  }

  const tournaments: Record<
    string,
    { players: number; teams: number; lastRegistrationAt: string | null; registrationOpen: boolean }
  > = {};
  for (const slug of KNOWN_SLUGS) {
    tournaments[slug] = {
      players: 0,
      teams: 0,
      lastRegistrationAt: null,
      registrationOpen: TOURNAMENTS[slug]?.registrationOpen !== false && !runtimeClosed.has(slug),
    };
  }
  let total = 0;
  for (const row of counts.results) {
    const entry = tournaments[row.slug];
    if (!entry) continue; // registration for a deleted tournament — orphaned
    const n = Number(row.n);
    total += n;
    if (row.type === 'team') entry.teams = n;
    else entry.players = n;
    if (row.last && (!entry.lastRegistrationAt || row.last > entry.lastRegistrationAt)) {
      entry.lastRegistrationAt = row.last;
    }
  }

  return json({
    tournaments,
    totals: { registrations: total, last7Days: Number(recent7d.results[0]?.n ?? 0) },
    recent: recent.results
      .filter((r) => KNOWN_SLUGS.has(r.tournament_slug))
      .slice(0, 6)
      .map((r) => ({
        tournament: r.tournament_slug,
        type: r.type,
        name: r.name,
        at: r.created_at,
      })),
  });
};

export const onRequest: PagesFunction<Env> = async () =>
  json({ error: 'Method not allowed' }, 405);
