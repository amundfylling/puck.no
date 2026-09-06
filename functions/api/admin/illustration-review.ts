/// <reference types="@cloudflare/workers-types" />
import { adminIdentity } from '../../lib/admin-auth.ts';
import { parseScene } from '../../../src/lib/illustration-scene.ts';

const REPO = 'amundfylling/puck.no';
const ROOT = `/repos/${REPO}`;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
class ApiError extends Error {
  status: number;
  constructor(status: number) { super('GitHub-forespørselen mislyktes.'); this.status = status; }
}
interface Review { number: number; state: string; merged_at: string | null; head: { ref: string }; }
const reviewResult = (review: Review) => ({ number: review.number, url: `https://github.com/${REPO}/pull/${review.number}`, state: review.merged_at ? 'merged' : review.state });

export const onRequest: PagesFunction<CloudflareEnv & { GITHUB_TOKEN?: string }> = async context => {
  if (!adminIdentity(context.data)) return json({ error: 'Ikke tilgang.' }, 403);
  if (!['GET', 'POST'].includes(context.request.method)) return json({ error: 'Metoden er ikke tillatt.' }, 405);
  const token = context.env.GITHUB_TOKEN;
  if (!token) return json({ error: 'Innsending er ikke konfigurert. GITHUB_TOKEN trenger tilgang til innhold og pull requests (se LAUNCH.md).' }, 503);
  const gh = async <T>(path: string, method = 'GET', body?: unknown): Promise<T> => {
    const response = await fetch(`https://api.github.com${ROOT}${path}`, {
      method, signal: AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'puck-no-admin', 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new ApiError(response.status);
    return await response.json() as T;
  };
  try {
    if (context.request.method === 'GET') {
      const params = new URL(context.request.url).searchParams;
      const number = params.get('review') ?? '';
      const slug = params.get('slug') ?? '';
      if (!/^[1-9]\d{0,8}$/.test(number) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return json({ error: 'Ugyldig kontroll.' }, 400);
      const review = await gh<Review>(`/pulls/${number}`);
      if (!review.head.ref.startsWith(`codex/illustration-${slug}-`)) return json({ error: 'Kontrollen tilhører ikke illustrasjonen.' }, 404);
      return json(reviewResult(review));
    }
    // Bound the actual stream, including requests without Content-Length.
    const reader = context.request.body?.getReader();
    if (!reader) return json({ error: 'Mangler innhold.' }, 400);
    let text = '';
    let bytes = 0;
    const decoder = new TextDecoder();
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 150_000) { await reader.cancel(); return json({ error: 'Illustrasjonen er for stor.' }, 413); }
      text += decoder.decode(part.value, { stream: true });
    }
    text += decoder.decode();
    let body, scene;
    try {
      body = JSON.parse(text);
      if (!body || typeof body.slug !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(body.slug) || body.slug.length > 100) throw new Error('Ugyldig kombinasjon.');
      scene = parseScene(body.scene, body.slug, false);
      if (body.baseScene !== null) parseScene(body.baseScene, body.slug, false);
    } catch (error) { return json({ error: error instanceof Error ? error.message : 'Ugyldig illustrasjon.' }, 400); }
    const slug: string = body.slug;
    const ref = await gh<{ object: { sha: string } }>('/git/ref/heads/main');
    const base = ref.object.sha;
    const readFile = async (path: string) => {
      const file = await gh<{ content: string }>(`/contents/${path}?ref=${base}`);
      return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(file.content.replace(/\n/g, '')), c => c.charCodeAt(0))));
    };
    let trick;
    try { trick = await readFile(`src/content/tricks/${slug}.json`); }
    catch (error) { if (error instanceof ApiError && error.status === 404) return json({ error: 'Ukjent kombinasjon.' }, 400); throw error; }
    const path = `src/content/illustrations/${slug}.json`;
    let current = null;
    try { current = parseScene(await readFile(path), slug, false); }
    catch (error) { if (!(error instanceof ApiError && error.status === 404)) throw error; }
    const baseScene = body.baseScene === null ? null : parseScene(body.baseScene, slug, false);
    const content = JSON.stringify(scene);
    // Content-addressed branches make retries after timeouts idempotent.
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(baseScene) + '\n' + content));
    const hash = Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    const branch = `codex/illustration-${slug}-${hash}`;
    const findReview = () => gh<Review[]>(`/pulls?state=all&head=${encodeURIComponent(`amundfylling:${branch}`)}&base=main`);
    const existing = (await findReview())[0];
    if (existing) return json(reviewResult(existing));
    if (JSON.stringify(current) !== JSON.stringify(baseScene)) return json({ error: 'Illustrasjonen er endret siden siden ble lastet. Eksporter utkastet som sikkerhetskopi, last siden på nytt og sammenlign før du sender inn.' }, 409);
    if (JSON.stringify(current) === content && trick.illustration === slug) return json({ error: 'Ingen endringer å sende inn.' }, 409);
    // Build one atomic commit containing the scene and its content reference.
    const commit = await gh<{ tree: { sha: string } }>(`/git/commits/${base}`);
    const files = [{ path, mode: '100644', type: 'blob', content: `${JSON.stringify(scene, null, 2)}\n` }];
    if (trick.illustration !== slug) files.push({ path: `src/content/tricks/${slug}.json`, mode: '100644', type: 'blob', content: `${JSON.stringify({ ...trick, illustration: slug }, null, 2)}\n` });
    const tree = await gh<{ sha: string }>('/git/trees', 'POST', { base_tree: commit.tree.sha, tree: files });
    const next = await gh<{ sha: string }>('/git/commits', 'POST', { message: `Oppdater illustrasjon: ${slug}`, tree: tree.sha, parents: [base] });
    try { await gh('/git/refs', 'POST', { ref: `refs/heads/${branch}`, sha: next.sha }); }
    catch (error) {
      if (!(error instanceof ApiError && error.status === 422)) throw error;
      // Never overwrite an existing branch. Verify its payload before retrying PR creation.
      const file = await gh<{ content: string }>(`/contents/${path}?ref=${encodeURIComponent(branch)}`);
      const stored = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(file.content.replace(/\n/g, '')), c => c.charCodeAt(0))));
      if (JSON.stringify(parseScene(stored, slug, false)) !== content) return json({ error: 'Innsendingen kolliderte med en annen endring.' }, 409);
    }
    let review;
    try {
      review = await gh<Review>('/pulls', 'POST', { title: `Illustrasjon: ${slug}`, head: branch, base: 'main', body: `Illustrasjon sendt fra adminverkstedet.\n\n${scene.published ? 'Redaktøren har valgt å erstatte det eldre diagrammet.' : 'Det eldre diagrammet beholdes hvis det finnes.'}\n\nKontroller forhåndsvisning og bygg før sammenslåing. Nettsiden oppdateres først etter sammenslåing og vellykket produksjonsbygg.` });
    } catch (error) { const retry = (await findReview())[0]; if (!retry) throw error; review = retry; }
    return json(reviewResult(review));
  } catch (error) {
    if (error instanceof ApiError && [401, 403].includes(error.status)) return json({ error: 'GitHub avviste tilgangen. Kontroller at GITHUB_TOKEN har Contents og Pull requests med skrivetilgang (se LAUNCH.md).' }, 503);
    console.error('illustration-review failed', error instanceof ApiError ? error.status : 'request-failed');
    return json({ error: 'Kunne ikke fullføre innsendingen. Utkastet beholdes. Prøv igjen; samme utkast oppretter ikke en ekstra kontroll.' }, 502);
  }
};
