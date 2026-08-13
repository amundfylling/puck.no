/// <reference types="@cloudflare/workers-types" />
/**
 * POST /api/registrations — Turnstile-protected public registration.
 * Player identity, club, country, world rank and ITHF points are always
 * resolved server-side. Team rosters may mix ranked and unranked players.
 */
import { createRegistration, RegistrationError, type RegistrationPayload } from '../lib/registration';
import { BodyTooLargeError, readRequestTextLimited } from '../lib/http';
import { KNOWN_SLUGS, TOURNAMENTS } from '../lib/tournaments';
import {
  MAX_TURNSTILE_TOKEN_LENGTH,
  parseTurnstileHostnames,
  verifyTurnstile,
} from '../lib/turnstile';

interface Env extends CloudflareEnv {
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
  if (
    typeof body.turnstileToken !== 'string' ||
    !body.turnstileToken ||
    body.turnstileToken.length > MAX_TURNSTILE_TOKEN_LENGTH
  ) {
    return json({ error: 'Mangler robot-verifisering. Last inn siden på nytt og prøv igjen.' }, 400);
  }
  const secret = context.env.TURNSTILE_SECRET_KEY;
  const allowedHostnames = parseTurnstileHostnames(context.env.TURNSTILE_HOSTNAMES);
  if (!secret || allowedHostnames.size === 0) {
    console.error(JSON.stringify({
      event: 'configuration_error',
      component: 'turnstile',
      missingSecret: !secret,
      missingHostnames: allowedHostnames.size === 0,
    }));
    return json({ error: 'Registreringen er ikke konfigurert riktig. Kontakt amund.fylling@puck.no.' }, 500);
  }
  if (!(await verifyTurnstile(
    secret,
    body.turnstileToken,
    context.request.headers.get('CF-Connecting-IP'),
    allowedHostnames,
  ))) {
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
    console.error(JSON.stringify({
      event: 'registration_error',
      kind: error instanceof Error ? error.name : 'Error',
    }));
    return json({ error: 'Noe gikk galt. Prøv igjen senere.' }, 500);
  }
};

export const onRequest: PagesFunction<Env> = async () => json({ error: 'Method not allowed' }, 405);
