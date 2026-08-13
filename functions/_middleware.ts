/// <reference types="@cloudflare/workers-types" />
/**
 * Site middleware:
 * - serves the language-appropriate static 404 page;
 * - negotiates build-generated Markdown for public HTML pages; and
 * - adds agent-discovery response headers to the public site.
 */
interface Env extends CloudflareEnv {
  ASSETS: Fetcher;
}

const CONTENT_SIGNAL = 'ai-train=no, search=yes, ai-input=yes';
const HOME_LINKS = [
  '</.well-known/api-catalog>; rel="api-catalog"; type="application/linkset+json"',
  '</openapi.json>; rel="service-desc"; type="application/openapi+json"',
  '</api-docs.md>; rel="service-doc"; type="text/markdown"',
  '</llms.txt>; rel="describedby"; type="text/plain"',
].join(', ');

/** Kept separate for preview-indexing policy tests and future middleware use. */
export function isProductionHostname(hostname: string): boolean {
  return ['www.puck.no', 'puck.no', 'localhost', '127.0.0.1'].includes(hostname.toLowerCase());
}

export function acceptsMarkdown(header: string | null): boolean {
  if (!header) return false;
  return header.split(',').some((range) => {
    const [mediaType, ...parameters] = range.trim().toLowerCase().split(';');
    if (mediaType !== 'text/markdown') return false;
    const q = parameters.find((parameter) => parameter.trim().startsWith('q='));
    return q == null || Number(q.trim().slice(2)) > 0;
  });
}

function markdownAssetPath(pathname: string): string | null {
  if (pathname === '/') return '/__agent-markdown/index.md';
  if (pathname.endsWith('/')) return `/__agent-markdown${pathname}index.md`;
  if (pathname.endsWith('.html')) {
    return `/__agent-markdown${pathname.slice(0, -'.html'.length)}.md`;
  }
  return null;
}

function isPublicContentPath(pathname: string): boolean {
  return !pathname.startsWith('/api/')
    && pathname !== '/api'
    && !pathname.startsWith('/admin/')
    && pathname !== '/admin'
    && !pathname.startsWith('/.well-known/')
    && !pathname.startsWith('/__agent-markdown/');
}

function appendVary(headers: Headers, value: string): void {
  const values = (headers.get('Vary') ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!values.some((entry) => entry.toLowerCase() === value.toLowerCase())) values.push(value);
  headers.set('Vary', values.join(', '));
}

function decoratePublicResponse(request: Request, response: Response): Response {
  const url = new URL(request.url);
  const headers = new Headers(response.headers);
  const contentType = headers.get('Content-Type')?.toLowerCase() ?? '';
  if (isPublicContentPath(url.pathname) && (contentType.includes('text/html') || contentType.includes('text/markdown'))) {
    headers.set('Content-Signal', CONTENT_SIGNAL);
  }
  if (url.pathname === '/' && response.status >= 200 && response.status < 400) {
    headers.set('Link', HOME_LINKS);
  }
  return new Response(request.method === 'HEAD' ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function markdownResponse(request: Request, env: Env): Promise<Response | null> {
  if (!['GET', 'HEAD'].includes(request.method)) return null;
  const url = new URL(request.url);
  if (!isPublicContentPath(url.pathname) || !acceptsMarkdown(request.headers.get('Accept'))) return null;
  const assetPath = markdownAssetPath(url.pathname);
  if (!assetPath) return null;

  const asset = await env.ASSETS.fetch(new URL(assetPath, request.url));
  if (!asset.ok) return null;
  const markdown = await asset.text();
  const headers = new Headers(asset.headers);
  headers.set('Content-Type', 'text/markdown; charset=utf-8');
  headers.set('Content-Signal', CONTENT_SIGNAL);
  headers.set('X-Markdown-Tokens', String(Math.ceil(new TextEncoder().encode(markdown).length / 4)));
  appendVary(headers, 'Accept');
  for (const name of ['Content-Encoding', 'Content-Length', 'Content-Range', 'ETag', 'Last-Modified', 'Transfer-Encoding']) {
    headers.delete(name);
  }
  return decoratePublicResponse(
    request,
    new Response(request.method === 'HEAD' ? null : markdown, { status: 200, headers }),
  );
}

async function localized404(request: Request, env: Env, response: Response): Promise<Response> {
  if (response.status !== 404) return response;
  const path = new URL(request.url).pathname;
  if (path.startsWith('/api/')) return response;

  const isEn = path === '/en' || path.startsWith('/en/');
  // Root 404.astro builds to /404.html; with trailingSlash:'always' the EN
  // one builds to /en/404/index.html — try both forms.
  const candidates = isEn ? ['/en/404.html', '/en/404/'] : ['/404.html', '/404/'];
  for (const candidate of candidates) {
    const page = await env.ASSETS.fetch(new URL(candidate, request.url));
    if (page.ok) {
      const headers = new Headers(page.headers);
      headers.set('Content-Type', 'text/html; charset=utf-8');
      return new Response(request.method === 'HEAD' ? null : page.body, { status: 404, headers });
    }
  }
  return response;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const markdown = await markdownResponse(context.request, context.env);
  if (markdown) return markdown;

  const response = await localized404(context.request, context.env, await context.next());
  return decoratePublicResponse(context.request, response);
};
