/**
 * puck-no remote MCP worker — entry point / router.
 *
 * Public endpoints (OAuth 2.1, per MCP auth spec):
 *   GET  /.well-known/oauth-protected-resource[/*]
 *   GET  /.well-known/oauth-authorization-server[/*]
 *   GET  /.well-known/mcp/server-card.json
 *   POST /register   (RFC 7591 dynamic client registration)
 *   GET  /authorize  → GitHub OAuth (identity) + collaborator check (authz)
 *   GET  /callback
 *   POST /token      (PKCE S256)
 *   GET  /health     (public liveness)
 *
 * Protected endpoint:
 *   /mcp — Bearer token required (401 + WWW-Authenticate otherwise).
 */
import {
  protectedResource, authorizationServerMetadata, register, authorize, callback, approve, token,
  authenticate, baseUrl, jsonRes,
} from './oauth.js';
import { handleMcp } from './mcp.js';
import { isOsloRefreshTime, refreshUpcomingRankings } from './rankingSync.js';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id',
  'Access-Control-Max-Age': '86400',
};

function withCors(res) {
  const next = new Response(res.body, res);
  for (const [k, v] of Object.entries(CORS)) next.headers.set(k, v);
  return next;
}

function serverCard(request) {
  const base = baseUrl(request);
  return jsonRes({
    serverInfo: {
      name: 'puck-no-admin-remote',
      version: '1.0.0',
      description: 'Authorized NBHF administration tools for tournaments, registrations, content and deployment status.',
    },
    transport: { type: 'streamable-http', endpoint: `${base}/mcp` },
    remotes: [{
      type: 'streamable-http',
      url: `${base}/mcp`,
      authentication: {
        type: 'oauth2',
        protectedResourceMetadata: `${base}/.well-known/oauth-protected-resource`,
      },
    }],
    supportedProtocolVersions: ['2025-06-18', '2025-03-26', '2024-11-05'],
    capabilities: { tools: { listChanged: false } },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    let res;

    try {
      if (path === '/health') {
        res = jsonRes({ ok: true, service: 'puck-no-mcp-remote' });
      } else if (path === '/.well-known/oauth-protected-resource' || path.startsWith('/.well-known/oauth-protected-resource/')) {
        res = protectedResource(request);
      } else if (path === '/.well-known/oauth-authorization-server' || path.startsWith('/.well-known/oauth-authorization-server/')) {
        res = authorizationServerMetadata(request);
      } else if (path === '/.well-known/mcp/server-card.json') {
        res = serverCard(request);
      } else if (path === '/register' && request.method === 'POST') {
        res = await register(request, env);
      } else if (path === '/authorize' && request.method === 'GET') {
        res = await authorize(request, env);
      } else if (path === '/callback' && request.method === 'GET') {
        res = await callback(request, env);
      } else if (path === '/approve' && request.method === 'POST') {
        res = await approve(request, env);
      } else if (path === '/token' && request.method === 'POST') {
        res = await token(request, env);
      } else if (path === '/mcp') {
        const user = await authenticate(request, env);
        if (!user) {
          res = jsonRes({ error: 'unauthorized' }, 401, {
            'WWW-Authenticate': `Bearer resource_metadata="${baseUrl(request)}/.well-known/oauth-protected-resource"`,
          });
        } else {
          res = await handleMcp(request, env, user.login);
        }
      } else {
        res = jsonRes({ error: 'not_found' }, 404);
      }
    } catch (err) {
      console.error('worker error', err?.constructor?.name ?? 'Error');
      res = jsonRes({ error: 'internal_error' }, 500);
    }

    return withCors(res);
  },
  async scheduled(controller, env, ctx) {
    const scheduledAt = new Date(controller.scheduledTime);
    // Wrangler cron is UTC. It fires at both possible UTC offsets; exactly
    // one invocation is 03:00 Europe/Oslo across daylight-saving changes.
    if (!isOsloRefreshTime(scheduledAt)) return;
    ctx.waitUntil(
      refreshUpcomingRankings(env, scheduledAt)
        .then((result) => console.log(JSON.stringify({ event: 'ranking_refresh', ...result })))
        .catch((error) => {
          console.error('ranking refresh failed', error);
          throw error;
        }),
    );
  },
};
