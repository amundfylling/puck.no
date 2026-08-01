/// <reference types="@cloudflare/workers-types" />
/** Access-protected registration CRUD for the custom admin portal. */
import {
  createRegistration,
  RegistrationError,
  updateRegistration,
  type RegistrationPayload,
} from '../../lib/registration';
import { adminIdentity } from '../../lib/admin-auth';
import { KNOWN_SLUGS, TOURNAMENTS } from '../../lib/tournaments';

interface Env {
  DB: D1Database;
}

interface AdminPayload extends RegistrationPayload {
  tournament_slug?: unknown;
  id?: unknown;
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

async function payload(context: EventContext<Env, string, unknown>): Promise<AdminPayload> {
  try {
    const body = (await context.request.json()) as unknown;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('shape');
    return body as AdminPayload;
  } catch {
    throw new RegistrationError('Ugyldig forespørsel.');
  }
}

function target(body: AdminPayload): { slug: string; cfg: (typeof TOURNAMENTS)[string] } {
  if (typeof body.tournament_slug !== 'string' || !KNOWN_SLUGS.has(body.tournament_slug)) {
    throw new RegistrationError('Ukjent turnering.');
  }
  return { slug: body.tournament_slug, cfg: TOURNAMENTS[body.tournament_slug] };
}

async function handle(
  context: EventContext<Env, string, unknown>,
  action: (body: AdminPayload) => Promise<Response>,
): Promise<Response> {
  if (!adminIdentity(context.data)) return json({ error: 'Ikke tilgang.' }, 403);
  try {
    return await action(await payload(context));
  } catch (error) {
    if (error instanceof RegistrationError) return json({ error: error.message }, error.status);
    console.error('admin registration failed', error);
    return json({ error: 'Noe gikk galt. Prøv igjen senere.' }, 500);
  }
}

export const onRequestPost: PagesFunction<Env> = async (context) =>
  handle(context, async (body) => {
    const { slug, cfg } = target(body);
    const result = await createRegistration(context.env.DB, slug, cfg, body, { allowClosed: true });
    return json({ ok: true, id: result.id }, 201);
  });

export const onRequestPatch: PagesFunction<Env> = async (context) =>
  handle(context, async (body) => {
    const { slug, cfg } = target(body);
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) throw new RegistrationError('Ugyldig påmeldings-ID.');
    await updateRegistration(context.env.DB, slug, cfg, id, body);
    return json({ ok: true });
  });

export const onRequestDelete: PagesFunction<Env> = async (context) =>
  handle(context, async (body) => {
    const { slug } = target(body);
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) throw new RegistrationError('Ugyldig påmeldings-ID.');
    const result = await context.env.DB.prepare(
      'DELETE FROM registrations WHERE id = ? AND tournament_slug = ?',
    ).bind(id, slug).run();
    if (result.meta.changes === 0) throw new RegistrationError('Fant ikke påmeldingen.', 404);
    return json({ ok: true });
  });

export const onRequest: PagesFunction<Env> = async () => json({ error: 'Method not allowed' }, 405);
