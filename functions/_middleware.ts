/// <reference types="@cloudflare/workers-types" />
/**
 * Middleware: serve the LANGUAGE-APPROPRIATE 404 page for missing paths.
 *
 * Cloudflare Pages only serves the root /404.html on misses — without this
 * middleware a miss under /en/ would get the Norwegian 404. The 404 status
 * code is preserved (only the body is swapped). /api/* responses are left
 * alone so API error payloads (JSON) are never replaced by HTML.
 */
interface Env {
  ASSETS: Fetcher;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const response = await context.next();
  if (response.status !== 404) return response;

  const path = new URL(context.request.url).pathname;
  if (path.startsWith('/api/')) return response;

  const isEn = path === '/en' || path.startsWith('/en/');
  // Root 404.astro builds to /404.html; with trailingSlash:'always' the EN
  // one builds to /en/404/index.html — try both forms.
  const candidates = isEn ? ['/en/404.html', '/en/404/'] : ['/404.html', '/404/'];
  for (const candidate of candidates) {
    const page = await context.env.ASSETS.fetch(new URL(candidate, context.request.url));
    if (page.ok) {
      const headers = new Headers(page.headers);
      headers.set('Content-Type', 'text/html; charset=utf-8');
      return new Response(page.body, { status: 404, headers });
    }
  }
  return response; // fall back to whatever next() produced
};
