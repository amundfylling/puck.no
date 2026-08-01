/// <reference types="@cloudflare/workers-types" />
/**
 * POST /api/registrations — Turnstile-protected public registration.
 * Player identity, club, country, world rank and ITHF points are always
 * resolved server-side. Team rosters may mix ranked and unranked players.
 */
import { createRegistration, RegistrationError, type RegistrationPayload } from '../lib/registration';
import { BodyTooLargeError, readRequestTextLimited } from '../lib/http';
import { KNOWN_SLUGS, TOURNAMENTS } from '../lib/tournaments';

interface Env {
  DB: D1Database;
  TURNSTILE_SECRET_KEY?: string;
}

interface PublicPayload extends RegistrationPayload {
  tournament_slug?: unknown;
  turnstileToken?: unknown;
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

async function verifyTurnstile(secret: string, token: string, ip: string | null): Promise<boolean> {
  try {
    const form = new FormData();
    form.append('secret', secret);
    form.append('response', token);
    if (ip) form.append('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      signal: AbortSignal.timeout(8_000),
      body: form,
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: PublicPayload;
  const mediaType = (context.request.headers.get('Content-Type') ?? '').split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json') {
    return json({ error: 'Forespørselen må være JSON.' }, 415);
  }
  try {
    const raw = await readRequestTextLimited(context.request, 64 * 1024);
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('shape');
    body = parsed as PublicPayload;
  } catch (error) {
    if (error instanceof BodyTooLargeError) return json({ error: 'Forespørselen er for stor.' }, 413);
    return json({ error: 'Ugyldig forespørsel.' }, 400);
  }
  if (typeof body.tournament_slug !== 'string' || !KNOWN_SLUGS.has(body.tournament_slug)) {
    return json({ error: 'Ukjent turnering.' }, 400);
  }
  if (typeof body.turnstileToken !== 'string' || !body.turnstileToken) {
    return json({ error: 'Mangler robot-verifisering. Last inn siden på nytt og prøv igjen.' }, 400);
  }
  const secret = context.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.error('TURNSTILE_SECRET_KEY is not set');
    return json({ error: 'Registreringen er ikke konfigurert riktig. Kontakt amund.fylling@puck.no.' }, 500);
  }
  if (!(await verifyTurnstile(secret, body.turnstileToken, context.request.headers.get('CF-Connecting-IP')))) {
    return json({ error: 'Kunne ikke verifisere at du er et menneske. Prøv igjen.' }, 403);
  }

  try {
    const result = await createRegistration(
      context.env.DB,
      body.tournament_slug,
      TOURNAMENTS[body.tournament_slug],
      body,
    );
    return json({ ok: true, id: result.id }, 201);
  } catch (error) {
    if (error instanceof RegistrationError) return json({ error: error.message }, error.status);
    console.error('D1 registration failed', error);
    return json({ error: 'Noe gikk galt. Prøv igjen senere.' }, 500);
  }
};

export const onRequest: PagesFunction<Env> = async () => json({ error: 'Method not allowed' }, 405);
