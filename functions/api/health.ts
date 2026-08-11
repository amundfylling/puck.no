/// <reference types="@cloudflare/workers-types" />

const headers = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

export const onRequestGet: PagesFunction = async () =>
  new Response(JSON.stringify({ ok: true, service: 'puck.no-api' }), { headers });

export const onRequestHead: PagesFunction = async () => new Response(null, { headers });

export const onRequest: PagesFunction = async () =>
  new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers });
