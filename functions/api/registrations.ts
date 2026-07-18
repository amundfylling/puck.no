/// <reference types="@cloudflare/workers-types" />
/**
 * POST /api/registrations — register a player or team for a tournament.
 *
 * Body (JSON): { tournament_slug, type: 'player'|'team', name, country?,
 * email, phone?, world_ranking?, turnstileToken }
 *
 * Responses: 201 created · 400 validation (Norwegian messages) ·
 * 403 Turnstile failed · 409 duplicate · 405 other methods.
 * All queries are parameterised. Emails/phones are never exposed publicly
 * (see GET /api/tournaments/{slug}/players).
 */
import { KNOWN_SLUGS } from '../lib/slugs';

interface Env {
  DB: D1Database;
  TURNSTILE_SECRET_KEY?: string;
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9][0-9\s-]{0,29}$/;
const MAX = { name: 500, email: 254, country: 40, phone: 30 } as const;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
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
      body: form,
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

interface Payload {
  tournament_slug?: unknown;
  type?: unknown;
  name?: unknown;
  country?: unknown;
  email?: unknown;
  phone?: unknown;
  world_ranking?: unknown;
  turnstileToken?: unknown;
}

/** Returns a Norwegian error message, or null when valid. */
function validate(body: Payload): string | null {
  if (typeof body.tournament_slug !== 'string' || !KNOWN_SLUGS.has(body.tournament_slug)) {
    return 'Ukjent turnering.';
  }
  if (body.type !== 'player' && body.type !== 'team') {
    return 'Ugyldig registreringstype.';
  }
  if (typeof body.name !== 'string' || body.name.trim().length === 0) {
    return body.type === 'team' ? 'Spillere er påkrevd.' : 'Navn er påkrevd.';
  }
  if (body.name.length > MAX.name) return 'Navnet er for langt.';
  if (typeof body.email !== 'string' || body.email.length > MAX.email || !EMAIL_RE.test(body.email.trim())) {
    return 'Ugyldig e-postadresse.';
  }
  if (body.country != null && (typeof body.country !== 'string' || body.country.length > MAX.country)) {
    return 'Ugyldig land.';
  }
  if (body.phone != null && body.phone !== '') {
    if (typeof body.phone !== 'string' || body.phone.length > MAX.phone || !PHONE_RE.test(body.phone.trim())) {
      return 'Ugyldig telefonnummer.';
    }
  }
  if (body.world_ranking != null && body.world_ranking !== '') {
    const n = Number(body.world_ranking);
    if (!Number.isInteger(n) || n < 0 || n > 1000000) {
      return 'Verdensranking må være et heltall.';
    }
  }
  if (typeof body.turnstileToken !== 'string' || body.turnstileToken.length === 0) {
    return 'Mangler robot-verifisering. Last inn siden på nytt og prøv igjen.';
  }
  return null;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  let body: Payload;
  try {
    body = (await context.request.json()) as Payload;
  } catch {
    return json({ error: 'Ugyldig forespørsel.' }, 400);
  }

  const invalid = validate(body);
  if (invalid) return json({ error: invalid }, 400);

  const secret = context.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    console.error('TURNSTILE_SECRET_KEY is not set');
    return json({ error: 'Registreringen er ikke konfigurert riktig. Kontakt amund.fylling@puck.no.' }, 500);
  }
  const ok = await verifyTurnstile(secret, body.turnstileToken as string, context.request.headers.get('CF-Connecting-IP'));
  if (!ok) {
    return json({ error: 'Kunne ikke verifisere at du er et menneske. Prøv igjen.' }, 403);
  }

  const name = (body.name as string).trim();
  const email = (body.email as string).trim().toLowerCase();
  const country = typeof body.country === 'string' && body.country.trim() ? body.country.trim().toUpperCase() : null;
  const phone = typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : null;
  const wr = body.world_ranking != null && body.world_ranking !== '' ? Number(body.world_ranking) : null;

  try {
    const result = await context.env.DB.prepare(
      `INSERT INTO registrations (tournament_slug, type, name, country, email, phone, world_ranking)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(body.tournament_slug as string, body.type as string, name, country, email, phone, wr)
      .run();
    return json({ ok: true, id: result.meta.last_row_id }, 201);
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE constraint failed')) {
      return json({ error: 'Spiller er allerede registrert!' }, 409);
    }
    console.error('D1 insert failed', err);
    return json({ error: 'Noe gikk galt. Prøv igjen senere.' }, 500);
  }
};

export const onRequest: PagesFunction<Env> = async () =>
  json({ error: 'Method not allowed' }, 405);
