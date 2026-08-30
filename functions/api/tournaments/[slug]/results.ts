/// <reference types="@cloudflare/workers-types" />
/** GET /api/tournaments/{slug}/results — public, non-personal stage snapshot. */
import { isSportScorpionStageArray } from '../../../lib/sportscorpion.js';
import { KNOWN_SLUGS, TOURNAMENTS } from '../../../lib/tournaments';

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

interface ResultRow {
  provider_tournament_id: number;
  stages_json: string;
  synced_at: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const slug = String(context.params.slug);
  if (!KNOWN_SLUGS.has(slug)) return json({ error: 'Ukjent turnering.' }, 404);
  const configured = TOURNAMENTS[slug]?.results;
  if (!configured) return json({ error: 'Turneringen har ikke et resultatsenter.' }, 404);

  let row: ResultRow | null;
  try {
    row = await context.env.DB.prepare(
      `SELECT provider_tournament_id, stages_json, synced_at
       FROM tournament_results
       WHERE tournament_slug = ? AND provider = 'sportscorpion'`,
    ).bind(slug).first<ResultRow>();
  } catch (error) {
    if (error instanceof Error && /no such table.*tournament_results/i.test(error.message)) {
      return json({ error: 'Ingen synkroniserte resultater.' }, 404);
    }
    console.error(JSON.stringify({
      event: 'tournament_results_read_failed',
      slug,
      kind: error instanceof Error ? error.name : 'Error',
    }));
    return json({ error: 'Resultatene er midlertidig utilgjengelige.' }, 503);
  }
  if (!row || Number(row.provider_tournament_id) !== configured.tournamentId) {
    return json({ error: 'Ingen synkroniserte resultater.' }, 404);
  }

  try {
    const stages = JSON.parse(row.stages_json) as unknown;
    if (!isSportScorpionStageArray(stages)) throw new Error('invalid snapshot');
    return json({ stages, syncedAt: row.synced_at });
  } catch {
    console.error(JSON.stringify({ event: 'tournament_results_snapshot_invalid', slug }));
    return json({ error: 'Resultatene er midlertidig utilgjengelige.' }, 503);
  }
};

export const onRequest: PagesFunction<Env> = async () =>
  json({ error: 'Method not allowed' }, 405);
