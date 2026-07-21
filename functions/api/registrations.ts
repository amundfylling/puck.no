/// <reference types="@cloudflare/workers-types" />
/**
 * POST /api/registrations — register a player or team for a tournament.
 *
 * Body (JSON):
 *   player: { tournament_slug, type: 'player', playerId? | name, email, phone?, turnstileToken }
 *   team:   { tournament_slug, type: 'team',   playerIds?: id[] | names?: string[],
 *             email, phone?, turnstileToken }
 *
 * Tournaments are individual by default; team tournaments (teamMin/teamMax in
 * frontmatter) accept only type 'team' with between teamMin and teamMax
 * players. With playerId(s), the server looks the player(s) up in the LIVE
 * ITHF world ranking (stiga.trefik.cz, cf-cached 6h) and derives
 * name/country/WR itself — client-sent country/world_ranking are IGNORED
 * (tamper-proof). Without playerId (new/unranked player), name is free text
 * and country/WR stay NULL. Contact info (email/phone) is stored once per
 * registration — for teams, for the team as a whole.
 *
 * Duplicates are rejected per tournament on player_id for ranked players
 * (one ITHF id per person, regardless of email) and on lower(email) for
 * everyone else (partial unique indexes in migrations/0002_player_id.sql).
 *
 * Responses: 201 created · 400 validation (Norwegian messages) ·
 * 403 Turnstile failed · 409 duplicate · 502 ranking unavailable ·
 * 405 other methods. All queries are parameterised.
 */
import { KNOWN_SLUGS, TOURNAMENTS } from '../lib/tournaments';

interface Env {
  DB: D1Database;
  TURNSTILE_SECRET_KEY?: string;
}

const RANKING_URL = 'https://stiga.trefik.cz/ithf/ranking/ranking.txt';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[0-9][0-9\s-]{0,29}$/;
const MAX = { name: 500, email: 254, phone: 30 } as const;

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

interface RankedPlayer {
  rank: number;
  id: number;
  name: string;
  club: string;
  nation: string;
}

/** Fetch + parse the live ITHF ranking (cf-cached 6h). Throws on failure. */
async function fetchRanking(): Promise<Map<number, RankedPlayer>> {
  const res = await fetch(RANKING_URL, {
    cf: { cacheTtl: 21600, cacheEverything: true },
  });
  if (!res.ok) throw new Error(`ranking HTTP ${res.status}`);
  const tsv = await res.text();
  const map = new Map<number, RankedPlayer>();
  for (const line of tsv.split(/\r?\n/).slice(2)) {
    if (!line.trim()) continue;
    const [rank, id, name, club, nation] = line.split('\t');
    const r = Number(rank);
    const i = Number(id);
    if (Number.isInteger(r) && Number.isInteger(i) && name) {
      map.set(i, { rank: r, id: i, name, club: club ?? '', nation: nation ?? '' });
    }
  }
  return map;
}

interface Payload {
  tournament_slug?: unknown;
  type?: unknown;
  name?: unknown;
  names?: unknown;
  email?: unknown;
  phone?: unknown;
  playerId?: unknown;
  playerIds?: unknown;
  turnstileToken?: unknown;
}

/**
 * Basic shape validation (Norwegian message or null). Enforces the tournament's
 * registration kind (individual by default; team with teamMin/teamMax players
 * when configured). playerId(s)/name resolution happens after.
 */
function validate(body: Payload): string | null {
  if (typeof body.tournament_slug !== 'string' || !KNOWN_SLUGS.has(body.tournament_slug)) {
    return 'Ukjent turnering.';
  }
  const cfg = TOURNAMENTS[body.tournament_slug as string];
  const isTeam = cfg.teamMin != null && cfg.teamMax != null;

  if (isTeam) {
    if (body.type !== 'team') return 'Denne turneringen er en lagturnering.';
    const ids = Array.isArray(body.playerIds) ? body.playerIds : null;
    const names = Array.isArray(body.names) ? body.names : null;
    if ((ids == null) === (names == null)) return 'Ugyldig registrering.';
    const count = (ids ?? names)!.length;
    if (count < cfg.teamMin! || count > cfg.teamMax!) {
      return `Laget må ha mellom ${cfg.teamMin} og ${cfg.teamMax} spillere.`;
    }
    if (ids && ids.some((v) => asId(v) == null)) return 'Ugyldig spiller.';
    if (names && names.some((n) => typeof n !== 'string' || !n.trim() || n.length > MAX.name)) {
      return 'Spillernavn er påkrevd.';
    }
  } else {
    if (body.type !== 'player') return 'Denne turneringen er individuell.';
    if (body.playerId == null) {
      if (typeof body.name !== 'string' || body.name.trim().length === 0) {
        return 'Navn er påkrevd.';
      }
      if (body.name.length > MAX.name) return 'Navnet er for langt.';
    }
  }

  if (typeof body.email !== 'string' || body.email.length > MAX.email || !EMAIL_RE.test(body.email.trim())) {
    return 'Ugyldig e-postadresse.';
  }
  if (body.phone != null && body.phone !== '') {
    if (typeof body.phone !== 'string' || body.phone.length > MAX.phone || !PHONE_RE.test(body.phone.trim())) {
      return 'Ugyldig telefonnummer.';
    }
  }
  if (typeof body.turnstileToken !== 'string' || body.turnstileToken.length === 0) {
    return 'Mangler robot-verifisering. Last inn siden på nytt og prøv igjen.';
  }
  return null;
}

function asId(v: unknown): number | null {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
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

  // Resolve name/country/WR. Client-sent country/world_ranking are ignored on purpose.
  let name: string;
  let country: string | null = null;
  let wr: number | null = null;
  let playerId: number | null = null;

  if (body.type === 'team') {
    const ids = Array.isArray(body.playerIds)
      ? body.playerIds.map(asId).filter((v): v is number => v != null)
      : null;
    if (ids) {
      let ranking: Map<number, RankedPlayer>;
      try {
        ranking = await fetchRanking();
      } catch (err) {
        console.error('ranking fetch failed', err);
        return json({ error: 'Kunne ikke hente verdensrankingen. Prøv igjen senere.' }, 502);
      }
      const resolved = ids.map((id) => ranking.get(id));
      if (resolved.some((p) => !p)) {
        return json({ error: 'Spilleren ble ikke funnet på verdensrankingen.' }, 400);
      }
      name = resolved.map((p) => p!.name).join(' / ');
    } else {
      name = (body.names as string[]).map((n) => n.trim()).join(' / ');
    }
  } else {
    const id = asId(body.playerId);
    if (id != null) {
      let ranking: Map<number, RankedPlayer>;
      try {
        ranking = await fetchRanking();
      } catch (err) {
        console.error('ranking fetch failed', err);
        return json({ error: 'Kunne ikke hente verdensrankingen. Prøv igjen senere.' }, 502);
      }
      const player = ranking.get(id);
      if (!player) {
        return json({ error: 'Spilleren ble ikke funnet på verdensrankingen.' }, 400);
      }
      name = player.name;
      country = player.nation || null;
      wr = player.rank;
      playerId = id;
    } else {
      name = (body.name as string).trim();
    }
  }

  const email = (body.email as string).trim().toLowerCase();
  const phone = typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : null;

  try {
    const result = await context.env.DB.prepare(
      `INSERT INTO registrations (tournament_slug, type, name, country, email, phone, world_ranking, player_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(body.tournament_slug as string, body.type as string, name, country, email, phone, wr, playerId)
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
