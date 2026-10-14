/// <reference types="@cloudflare/workers-types" />
/**
 * POST /api/awards/nominations — Turnstile-protected Puck Awards nominations.
 * Stores one row per nominated category; nothing is ever read back publicly.
 */
import awardsConfig from '../../../src/data/puck-awards.json';
import { TURNSTILE_AWARDS_ACTION } from '../../../src/lib/turnstile.ts';
import { BodyTooLargeError, readRequestTextLimited } from '../../lib/http';
import { NominationError, nominationsOpen, parseNominations, type AwardsConfig } from '../../lib/puck-awards';
import {
  MAX_TURNSTILE_TOKEN_LENGTH,
  parseTurnstileHostnames,
  verifyTurnstile,
} from '../../lib/turnstile';

interface Env extends CloudflareEnv {
  TURNSTILE_SECRET_KEY?: string;
}

const config = awardsConfig as AwardsConfig;

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

export const onRequestPost: PagesFunction<Env> = async (context) => {
  if (!nominationsOpen(config)) {
    return json({ error: 'Nominasjonen er stengt.' }, 409);
  }
  const mediaType = (context.request.headers.get('Content-Type') ?? '').split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json') {
    return json({ error: 'Forespørselen må være JSON.' }, 415);
  }
  let body: Record<string, unknown>;
  try {
    const raw = await readRequestTextLimited(context.request, 32 * 1024);
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
    body = parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof BodyTooLargeError) return json({ error: 'Forespørselen er for stor.' }, 413);
    return json({ error: 'Ugyldig forespørsel.' }, 400);
  }

  let parsed;
  try {
    parsed = parseNominations(body, config);
  } catch (error) {
    if (error instanceof NominationError) return json({ error: error.message }, error.status);
    throw error;
  }

  const token = body.turnstileToken;
  if (typeof token !== 'string' || !token || token.length > MAX_TURNSTILE_TOKEN_LENGTH) {
    return json({ error: 'Mangler robot-verifisering. Last inn siden på nytt og prøv igjen.' }, 400);
  }
  const secret = context.env.TURNSTILE_SECRET_KEY;
  const allowedHostnames = parseTurnstileHostnames(context.env.TURNSTILE_HOSTNAMES);
  if (!secret || allowedHostnames.size === 0) {
    console.error(JSON.stringify({ event: 'configuration_error', component: 'turnstile' }));
    return json({ error: 'Nominasjonen er ikke konfigurert riktig. Kontakt amund.fylling@puck.no.' }, 500);
  }
  if (!(await verifyTurnstile(
    secret,
    token,
    context.request.headers.get('CF-Connecting-IP'),
    allowedHostnames,
    fetch,
    TURNSTILE_AWARDS_ACTION,
  ))) {
    return json({ error: 'Kunne ikke verifisere at du er et menneske. Prøv igjen.' }, 403);
  }

  try {
    const submissionId = crypto.randomUUID();
    const insert = context.env.DB.prepare(
      `INSERT INTO award_nominations (award_year, category, nominee, reason, nominator, submission_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    await context.env.DB.batch(parsed.nominations.map((n) =>
      insert.bind(config.year, n.category, n.nominee, n.reason, parsed.nominator, submissionId),
    ));
    return json({ ok: true, count: parsed.nominations.length }, 201);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'award_nomination_error',
      kind: error instanceof Error ? error.name : 'Error',
    }));
    return json({ error: 'Noe gikk galt. Prøv igjen senere.' }, 500);
  }
};

export const onRequest: PagesFunction<Env> = async () => json({ error: 'Method not allowed' }, 405);
