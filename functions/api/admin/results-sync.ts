/// <reference types="@cloudflare/workers-types" />
/**
 * POST /api/admin/results-sync — refresh one configured tournament's
 * SportScorpion stage list and persist the public snapshot in D1.
 *
 * This changes no Git content and triggers no Pages deployment. The public
 * tournament page reads the snapshot through its lightweight results API.
 */
import { adminIdentity } from '../../lib/admin-auth';
import { BodyTooLargeError, readRequestTextLimited, readResponseTextLimited } from '../../lib/http';
import { parseSportScorpionStages } from '../../lib/sportscorpion.js';
import { KNOWN_SLUGS, TOURNAMENTS } from '../../lib/tournaments';

type Env = CloudflareEnv;

const SPORTSCORPION_ORIGIN = 'https://th.sportscorpion.com';
const MAX_REQUEST_BYTES = 4 * 1024;
const MAX_HTML_BYTES = 2 * 1024 * 1024;

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

class ProviderError extends Error {}

async function fetchStages(tournamentId: number) {
  const url = `${SPORTSCORPION_ORIGIN}/eng/tournament/id/${tournamentId}/`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent': 'puck.no results updater (+https://www.puck.no/)',
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new ProviderError('network');
  }
  if (!response.ok) throw new ProviderError(`http_${response.status}`);
  if (new URL(response.url).origin !== SPORTSCORPION_ORIGIN) {
    throw new ProviderError('redirect_origin');
  }
  if (!response.headers.get('content-type')?.toLowerCase().includes('text/html')) {
    throw new ProviderError('content_type');
  }
  let html: string;
  try {
    html = await readResponseTextLimited(response, MAX_HTML_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLargeError) throw new ProviderError('response_too_large');
    throw error;
  }
  const stages = parseSportScorpionStages(html);
  if (stages.length === 0) throw new ProviderError('no_stages');
  return stages;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  if (!adminIdentity(context.data)) return json({ error: 'Ikke tilgang.' }, 403);

  let body: unknown;
  try {
    const raw = await readRequestTextLimited(context.request, MAX_REQUEST_BYTES);
    body = JSON.parse(raw) as unknown;
  } catch (error) {
    if (error instanceof BodyTooLargeError) return json({ error: 'Forespørselen er for stor.' }, 413);
    return json({ error: 'Ugyldig forespørsel.' }, 400);
  }
  const slug = body && typeof body === 'object' && !Array.isArray(body) &&
      typeof (body as { slug?: unknown }).slug === 'string'
    ? (body as { slug: string }).slug
    : '';
  if (!KNOWN_SLUGS.has(slug)) return json({ error: 'Ukjent turnering.' }, 400);

  const results = TOURNAMENTS[slug]?.results;
  if (!results || results.provider !== 'sportscorpion') {
    return json({ error: 'Turneringen er ikke koblet til SportScorpion.' }, 409);
  }

  let stages;
  try {
    stages = await fetchStages(results.tournamentId);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'sportscorpion_sync_failed',
      slug,
      kind: error instanceof ProviderError ? error.message : error instanceof Error ? error.name : 'Error',
    }));
    return json(
      { error: 'Kunne ikke hente etapper fra SportScorpion. Eksisterende resultater er beholdt.' },
      502,
    );
  }

  const syncedAt = new Date().toISOString();
  try {
    await context.env.DB.prepare(
      `INSERT INTO tournament_results
         (tournament_slug, provider, provider_tournament_id, stages_json, stage_count, synced_at)
       VALUES (?, 'sportscorpion', ?, ?, ?, ?)
       ON CONFLICT(tournament_slug) DO UPDATE SET
         provider = excluded.provider,
         provider_tournament_id = excluded.provider_tournament_id,
         stages_json = excluded.stages_json,
         stage_count = excluded.stage_count,
         synced_at = excluded.synced_at`,
    ).bind(slug, results.tournamentId, JSON.stringify(stages), stages.length, syncedAt).run();
  } catch (error) {
    console.error(JSON.stringify({
      event: 'sportscorpion_sync_store_failed',
      slug,
      kind: error instanceof Error ? error.name : 'Error',
    }));
    const missingMigration = error instanceof Error && /no such table.*tournament_results/i.test(error.message);
    return json(
      {
        error: missingMigration
          ? 'Resultatsynk er ikke satt opp i databasen ennå. Kjør D1-migrasjonene.'
          : 'Kunne ikke lagre resultatene. Eksisterende resultater er beholdt.',
      },
      503,
    );
  }

  console.log(JSON.stringify({
    event: 'sportscorpion_sync_complete',
    slug,
    tournamentId: results.tournamentId,
    stageCount: stages.length,
  }));
  return json({
    ok: true,
    slug,
    stages,
    stageCount: stages.length,
    syncedAt,
    message: `${stages.length} ${stages.length === 1 ? 'etappe' : 'etapper'} synkronisert uten ny publisering.`,
  });
};

export const onRequest: PagesFunction<Env> = async () =>
  json({ error: 'Method not allowed' }, 405);
