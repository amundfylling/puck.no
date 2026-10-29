/// <reference types="@cloudflare/workers-types" />
/**
 * GET/POST /api/unsubscribe?token=… — opt out of tournament reminder emails
 * (sent by the mcp-remote Worker, see mcp-remote/src/reminders.js).
 *
 * GET shows a confirm button so link scanners cannot unsubscribe anyone;
 * POST performs it (also RFC 8058 one-click from mail clients). The token is
 * random and stored in reminder_recipients — no email address is in the URL.
 */

type Env = CloudflareEnv;

const TOKEN_RE = /^[A-Za-z0-9_-]{20,64}$/;

function page(body: string, status = 200): Response {
  const html = `<!doctype html>
<html lang="no"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Avmelding – puck.no</title>
<style>body{font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;color:#0f172a;line-height:1.5}
button{font:inherit;padding:.5rem 1rem;background:#c8102e;color:#fff;border:0;border-radius:4px;cursor:pointer}
a{color:#c8102e}</style></head><body>${body}
<p><a href="/">puck.no</a></p></body></html>`;
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    },
  });
}

const invalid = () => page(`<h1>Ugyldig lenke</h1>
<p>Lenken er ugyldig eller utløpt. / This link is invalid or has expired.</p>`, 404);

function tokenFrom(request: Request): string | null {
  const token = new URL(request.url).searchParams.get('token');
  return token && TOKEN_RE.test(token) ? token : null;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const token = tokenFrom(request);
  if (!token) return invalid();
  const row = await env.DB.prepare('SELECT unsubscribed_at FROM reminder_recipients WHERE token = ?')
    .bind(token).first<{ unsubscribed_at: string | null }>();
  if (!row) return invalid();
  if (row.unsubscribed_at) {
    return page('<h1>Du er meldt av</h1><p>Du får ikke flere turneringspåminnelser. / You will not receive any more tournament reminders.</p>');
  }
  return page(`<h1>Meld av turneringspåminnelser</h1>
<p>Vil du slutte å få e-post om kommende turneringer fra puck.no?<br>
Stop receiving emails about upcoming tournaments from puck.no?</p>
<form method="post"><button type="submit">Meld meg av / Unsubscribe</button></form>`);
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const token = tokenFrom(request);
  if (!token) return invalid();
  const result = await env.DB.prepare(
    `UPDATE reminder_recipients SET unsubscribed_at = coalesce(unsubscribed_at, datetime('now'))
     WHERE token = ?`,
  ).bind(token).run();
  if (!result.meta.changes) return invalid();
  return page('<h1>Du er meldt av</h1><p>Du får ikke flere turneringspåminnelser. / You will not receive any more tournament reminders.</p>');
};

export const onRequest: PagesFunction<Env> = async () =>
  new Response(JSON.stringify({ error: 'Metoden er ikke tillatt.' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json; charset=utf-8', Allow: 'GET, POST' },
  });
