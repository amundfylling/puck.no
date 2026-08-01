/// <reference types="@cloudflare/workers-types" />
/**
 * POST /api/admin/registration-open — open or close registration for a
 * tournament from the admin portal.
 *
 * Body: { "slug": "…", "open": true|false }
 *
 * registrationOpen lives in the tournament frontmatter and reaches the API
 * via the generated tournament-config.json at build time — so this commits
 * the frontmatter change to main (NO file + EN mirror when it exists) via
 * the GitHub Git Data API (one atomic commit), and the change takes effect
 * after the next Pages build (2–4 min). Same mechanism as the CMS and the
 * puck-no-admin MCP server.
 *
 * Requires the GITHUB_TOKEN secret (repo scope) — a Pages secret, never in
 * git. Returns 503 with a setup hint when it is missing.
 *
 * Protected by Cloudflare Access at the edge and signed-assertion verification
 * in functions/api/admin/_middleware.ts.
 */
import { adminIdentity } from '../../lib/admin-auth';
import { KNOWN_SLUGS } from '../../lib/tournaments';

interface Env {
  DB: D1Database;
  GITHUB_TOKEN?: string;
}

const REPO = 'amundfylling/puck.no';
const API = 'https://api.github.com';

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

/** Set (or replace) registrationOpen in the YAML frontmatter; body untouched. */
function patchFrontmatter(markdown: string, open: boolean): string {
  const block = markdown.match(/^---\r?\n[\s\S]*?\r?\n---/);
  if (!block) throw new Error('Mangler frontmatter-blokk.');
  const line = `registrationOpen: ${open}`;
  let next: string;
  if (/^registrationOpen:/m.test(block[0])) {
    next = block[0].replace(/^registrationOpen:.*$/m, line);
  } else {
    next = block[0].replace(/(\r?\n)---$/, `$1${line}$1---`);
  }
  return markdown.replace(block[0], next);
}

function base64ToUtf8(b64: string): string {
  const bin = atob(b64.replace(/\n/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** GitHub API fetch with auth; throws Error with a Norwegian message. */
async function gh<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'puck-no-admin-portal',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new GitHubApiError(res.status, `GitHub API svarte ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

class GitHubApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

interface ContentsResponse {
  content: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  if (!adminIdentity(context.data)) return json({ error: 'Ikke tilgang.' }, 403);
  const token = context.env.GITHUB_TOKEN;
  if (!token) {
    return json(
      { error: 'Ikke satt opp ennå: GITHUB_TOKEN mangler som Pages-hemmelighet (se LAUNCH.md).' },
      503,
    );
  }

  let body: { slug?: unknown; open?: unknown };
  try {
    body = await context.request.json();
  } catch {
    return json({ error: 'Ugyldig JSON.' }, 400);
  }
  const slug = typeof body.slug === 'string' ? body.slug : '';
  const open = body.open;
  if (!KNOWN_SLUGS.has(slug)) return json({ error: 'Ukjent turnering.' }, 400);
  if (typeof open !== 'boolean') return json({ error: '«open» må være true eller false.' }, 400);

  // Apply the safety-critical runtime state first. Closed rows are vetoes;
  // opening removes the veto but can never override closed frontmatter.
  try {
    if (open) {
      await context.env.DB.prepare(
        'DELETE FROM tournament_settings WHERE tournament_slug = ?',
      ).bind(slug).run();
    } else {
      await context.env.DB.prepare(
        `INSERT INTO tournament_settings (tournament_slug, registration_open, updated_at)
         VALUES (?, 0, datetime('now'))
         ON CONFLICT(tournament_slug) DO UPDATE SET
           registration_open = 0,
           updated_at = excluded.updated_at`,
      ).bind(slug).run();
    }
  } catch (error) {
    console.error('runtime registration setting failed', error);
    return json({ error: 'Kunne ikke endre påmeldingsstatus i databasen.' }, 503);
  }

  // Pin every read to one immutable commit. If main advances before the final
  // ref update, GitHub rejects the non-fast-forward write instead of letting
  // stale content overwrite the newer edit.
  let baseSha: string;
  let noFile: ContentsResponse;
  let enFile: ContentsResponse | null = null;
  try {
    const ref = await gh<{ object: { sha: string } }>(token, `/repos/${REPO}/git/ref/heads/main`);
    baseSha = ref.object.sha;
    noFile = await gh<ContentsResponse>(
      token,
      `/repos/${REPO}/contents/src/content/tournaments/${slug}.md?ref=${encodeURIComponent(baseSha)}`,
    );
    try {
      enFile = await gh<ContentsResponse>(
        token,
        `/repos/${REPO}/contents/src/content/tournaments/en/${slug}.md?ref=${encodeURIComponent(baseSha)}`,
      );
    } catch (error) {
      if (error instanceof GitHubApiError && error.status === 404) enFile = null;
      else throw error;
    }
  } catch (e) {
    return json({ error: `Kunne ikke lese turneringsfilen: ${(e as Error).message}` }, 502);
  }

  const files: { path: string; content: string }[] = [
    {
      path: `src/content/tournaments/${slug}.md`,
      content: patchFrontmatter(base64ToUtf8(noFile.content), open),
    },
  ];
  if (enFile) {
    files.push({
      path: `src/content/tournaments/en/${slug}.md`,
      content: patchFrontmatter(base64ToUtf8(enFile.content), open),
    });
  }

  // One atomic commit: ref → base tree → blobs → new tree → commit → ref.
  try {
    const baseCommit = await gh<{ tree: { sha: string } }>(
      token,
      `/repos/${REPO}/git/commits/${baseSha}`,
    );
    const tree: { path: string; mode: '100644'; type: 'blob'; sha: string }[] = [];
    for (const file of files) {
      const blob = await gh<{ sha: string }>(token, `/repos/${REPO}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({ content: utf8ToBase64(file.content), encoding: 'base64' }),
      });
      tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const newTree = await gh<{ sha: string }>(token, `/repos/${REPO}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree }),
    });
    const commit = await gh<{ sha: string }>(token, `/repos/${REPO}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({
        message: `feat(tournaments): ${open ? 'open' : 'close'} registration for ${slug}`,
        tree: newTree.sha,
        parents: [baseSha],
      }),
    });
    await gh(token, `/repos/${REPO}/git/refs/heads/main`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });
    return json({
      ok: true,
      slug,
      registrationOpen: open,
      commit: commit.sha.slice(0, 7),
      message: open
        ? 'Åpning er lagret. API og skjema åpner senest ved neste bygg.'
        : 'Påmelding er stengt i API-et med én gang. Skjemaet synkroniseres av neste bygg.',
    });
  } catch (e) {
    const status = e instanceof GitHubApiError && e.status === 422 ? 409 : 502;
    const message = status === 409
      ? 'Innholdet ble endret samtidig. Last siden på nytt og prøv igjen.'
      : `Kunne ikke lagre: ${(e as Error).message}`;
    return json({ error: message }, status);
  }
};

export const onRequest: PagesFunction<Env> = async () =>
  json({ error: 'Method not allowed' }, 405);
