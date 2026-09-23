/// <reference types="@cloudflare/workers-types" />
/** Anonymous, one-choice-per-browser blog reactions. */
import { BLOG_POST_KEYS } from '../../../lib/blog-post-keys.ts';

type Env = CloudflareEnv;
type Reaction = 'heart' | 'fire' | 'laugh' | 'wow' | 'clap';
type Counts = Record<Reaction, number>;

const REACTIONS: readonly Reaction[] = ['heart', 'fire', 'laugh', 'wow', 'clap'];
const KNOWN_KEYS = new Set<string>(BLOG_POST_KEYS);
const COOKIE_NAME = 'puck_reaction_id';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(data: unknown, status = 200, cookie?: string): Response {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  if (cookie) headers.set('Set-Cookie', cookie);
  return new Response(JSON.stringify(data), { status, headers });
}

function postKey(params: Record<string, string | string[]>): string | null {
  const { lang, slug } = params;
  if (typeof lang !== 'string' || typeof slug !== 'string') return null;
  try {
    // Cloudflare Pages leaves percent encoding in dynamic route parameters.
    const key = `${lang}/${decodeURIComponent(slug)}`;
    return KNOWN_KEYS.has(key) ? key : null;
  } catch {
    return null;
  }
}

function browserId(request: Request): string | null {
  const cookie = request.headers.get('Cookie') ?? '';
  const token = cookie.split(';').map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`))?.slice(COOKIE_NAME.length + 1);
  return token && UUID_RE.test(token) ? token.toLowerCase() : null;
}

async function voterKey(key: string, id: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${key}:${id}`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function state(db: D1Database, key: string, voter: string | null) {
  const counts: Counts = { heart: 0, fire: 0, laugh: 0, wow: 0, clap: 0 };
  const countsPromise = db.prepare(
    'SELECT emoji, COUNT(*) AS total FROM blog_reactions WHERE post_key = ? GROUP BY emoji',
  ).bind(key).all<{ emoji: Reaction; total: number }>();
  const selectedPromise = voter
    ? db.prepare('SELECT emoji FROM blog_reactions WHERE post_key = ? AND voter_key = ? LIMIT 1')
      .bind(key, voter).first<{ emoji: Reaction }>()
    : Promise.resolve(null);
  const [rows, selected] = await Promise.all([countsPromise, selectedPromise]);
  for (const row of rows.results) {
    if (REACTIONS.includes(row.emoji)) counts[row.emoji] = Number(row.total);
  }
  return { counts, selected: selected?.emoji ?? null };
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const key = postKey(context.params);
  if (!key) return json({ error: 'Ukjent blogginnlegg.' }, 404);
  const id = browserId(context.request);
  try {
    return json(await state(context.env.DB, key, id ? await voterKey(key, id) : null));
  } catch (error) {
    console.error(JSON.stringify({ event: 'blog_reactions_read_failed', key, kind: error instanceof Error ? error.name : 'Error' }));
    return json({ error: 'Reaksjonene er midlertidig utilgjengelige.' }, 503);
  }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const key = postKey(context.params);
  if (!key) return json({ error: 'Ukjent blogginnlegg.' }, 404);

  // Reject cross-site browser writes. This does not authenticate visitors.
  const url = new URL(context.request.url);
  if (context.request.headers.get('Origin') !== url.origin) {
    return json({ error: 'Ugyldig forespørsel.' }, 403);
  }
  const values = url.searchParams.getAll('emoji');
  const choice = values.length === 1 ? values[0] : null;
  if (choice !== 'remove' && !REACTIONS.includes(choice as Reaction)) {
    return json({ error: 'Ugyldig reaksjon.' }, 400);
  }

  let id = browserId(context.request);
  let cookie: string | undefined;
  if (!id && choice !== 'remove') {
    id = crypto.randomUUID();
    cookie = `${COOKIE_NAME}=${id}; Path=/api/reactions; Max-Age=31536000; HttpOnly; SameSite=Lax${url.protocol === 'https:' ? '; Secure' : ''}`;
  }
  const voter = id ? await voterKey(key, id) : null;
  try {
    if (voter) {
      if (choice === 'remove') {
        await context.env.DB.prepare(
          'DELETE FROM blog_reactions WHERE post_key = ? AND voter_key = ?',
        ).bind(key, voter).run();
      } else {
        await context.env.DB.prepare(
          `INSERT INTO blog_reactions (post_key, voter_key, emoji) VALUES (?, ?, ?)
           ON CONFLICT (post_key, voter_key) DO UPDATE SET emoji = excluded.emoji`,
        ).bind(key, voter, choice).run();
      }
    }
    return json(await state(context.env.DB, key, voter), 200, cookie);
  } catch (error) {
    console.error(JSON.stringify({ event: 'blog_reactions_write_failed', key, kind: error instanceof Error ? error.name : 'Error' }));
    // Keep a newly issued ID even if a later read fails, so retrying cannot
    // create a second vote after a successful insert.
    return json({ error: 'Reaksjonen kunne ikke lagres.' }, 503, cookie);
  }
};

export const onRequest: PagesFunction<Env> = async () =>
  json({ error: 'Method not allowed' }, 405);
