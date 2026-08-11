import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

import { acceptsMarkdown, onRequest } from '../_middleware.ts';
import { createAgentSkillsIndex } from '../../scripts/gen-agent-skills-index.mjs';

const ROOT = path.resolve('.');

test('Markdown negotiation requires an explicit, acceptable text/markdown range', () => {
  assert.equal(acceptsMarkdown('text/markdown'), true);
  assert.equal(acceptsMarkdown('text/html, text/markdown;q=0.8'), true);
  assert.equal(acceptsMarkdown('text/markdown;q=0, text/html'), false);
  assert.equal(acceptsMarkdown('*/*'), false);
  assert.equal(acceptsMarkdown(null), false);
});

test('homepage responses advertise RFC 8288 discovery links', async () => {
  const response = await onRequest({
    request: new Request('https://www.puck.no/'),
    env: { ASSETS: { fetch: async () => new Response('missing', { status: 404 }) } },
    next: async () => new Response('<h1>puck.no</h1>', {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }),
  } as never);
  assert.match(response.headers.get('Link') ?? '', /rel="api-catalog"/);
  assert.match(response.headers.get('Link') ?? '', /rel="service-desc"/);
  assert.equal(response.headers.get('Content-Signal'), 'ai-train=no, search=yes, ai-input=yes');
});

test('homepage can return a Markdown variant with token and cache negotiation headers', async () => {
  const response = await onRequest({
    request: new Request('https://www.puck.no/', { headers: { Accept: 'text/markdown' } }),
    env: {
      ASSETS: {
        fetch: async (request: Request | URL | string) => {
          const href = request instanceof Request ? request.url : String(request);
          assert.equal(new URL(href).pathname, '/__agent-markdown/index.md');
          return new Response('# Norges Bordhockeyforbund\n');
        },
      },
    },
    next: async () => {
      throw new Error('HTML fallback should not be used');
    },
  } as never);
  assert.match(response.headers.get('Content-Type') ?? '', /^text\/markdown/);
  assert.match(response.headers.get('Vary') ?? '', /Accept/i);
  assert.ok(Number(response.headers.get('X-Markdown-Tokens')) > 0);
  assert.match(await response.text(), /^# Norges/);
});

test('agent skill index digest matches the published SKILL.md bytes', async () => {
  const root = path.join(ROOT, 'public/.well-known/agent-skills');
  const generated = await createAgentSkillsIndex(root);
  assert.equal(generated.$schema, 'https://schemas.agentskills.io/discovery/0.2.0/schema.json');
  assert.equal(generated.skills.length, 1);
  const skill = generated.skills[0];
  const bytes = await fs.readFile(path.join(root, skill.name, 'SKILL.md'));
  assert.equal(skill.digest, `sha256:${createHash('sha256').update(bytes).digest('hex')}`);
});

test('discovery JSON documents expose real service endpoints', async () => {
  const readJson = async (relative: string) =>
    JSON.parse(await fs.readFile(path.join(ROOT, relative), 'utf8'));
  const catalog = await readJson('public/.well-known/api-catalog');
  assert.ok(catalog.linkset.every((entry: Record<string, unknown>) => entry.anchor && entry['service-desc'] && entry['service-doc']));
  const protectedResource = await readJson('public/.well-known/oauth-protected-resource');
  assert.equal(protectedResource.resource, 'https://www.puck.no/mcp');
  assert.deepEqual(protectedResource.scopes_supported, ['admin']);
  const card = await readJson('public/.well-known/mcp/server-card.json');
  assert.equal(card.transport.endpoint, 'https://www.puck.no/mcp');
  const openapi = await readJson('public/openapi.json');
  assert.equal(openapi.openapi, '3.1.0');
  assert.ok(openapi.paths['/api/tournaments/{slug}/players']);
});

test('robots and WebMCP advertise the selected public agent policy', async () => {
  const robots = await fs.readFile(path.join(ROOT, 'public/robots.txt'), 'utf8');
  assert.match(robots, /Content-Signal: ai-train=no, search=yes, ai-input=yes/);
  const webmcp = await fs.readFile(path.join(ROOT, 'public/js/webmcp.js'), 'utf8');
  assert.match(webmcp, /modelContext\.registerTool/);
  assert.match(webmcp, /readOnlyHint: true/);
});
