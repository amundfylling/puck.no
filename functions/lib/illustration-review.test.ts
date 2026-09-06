import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequest } from '../api/admin/illustration-review.ts';
import { parseScene } from '../../src/lib/illustration-scene.ts';

const scene = parseScene(JSON.parse(readFileSync(new URL('../../src/content/illustrations/agdur.json', import.meta.url), 'utf8')), 'agdur');
const draft = { ...scene, published: !scene.published };
const context = (body: unknown, identity = true) => ({ request: new Request('https://www.puck.no/api/admin/illustration-review', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env: { GITHUB_TOKEN: 'test-token' }, data: identity ? { adminIdentity: { email: 'editor@example.com', subject: 'test' } } : {} });
const contents = (value: unknown) => ({ content: btoa(JSON.stringify(value)) });

test('rejects anonymous and invalid scenes before reaching GitHub', async () => {
  for (const [body, identity, status] of [[{ slug: 'agdur', scene: draft }, false, 403], [{ slug: '../escape', scene: draft }, true, 400], [{ slug: 'agdur', scene: { ...draft, paths: [] }, baseScene: scene }, true, 400]] as const) {
    const result = await onRequest(context(body, identity) as never);
    assert.equal(result.status, status);
  }
});

test('rejects oversized streamed input', async () => {
  const response = await onRequest(context({ junk: 'x'.repeat(150_001) }) as never);
  assert.equal(response.status, 413);
});

test('creates a review with an atomic scene/reference commit, never writes main', async t => {
  const calls: { path: string; method: string; body: Record<string, unknown> }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname;
    const body = init.body ? JSON.parse(String(init.body)) : {};
    calls.push({ path, method: init.method!, body });
    let result: unknown;
    if (path.endsWith('/git/ref/heads/main')) result = { object: { sha: 'base' } };
    else if (path.includes('/contents/src/content/tricks/')) result = contents({ slug: 'agdur', name: 'Agdur', diagram: '/legacy.png' });
    else if (path.includes('/contents/src/content/illustrations/')) result = contents(scene);
    else if (path.endsWith('/pulls') && init.method === 'GET') result = [];
    else if (path.endsWith('/git/commits/base')) result = { tree: { sha: 'base-tree' } };
    else if (path.endsWith('/git/trees')) result = { sha: 'new-tree' };
    else if (path.endsWith('/git/commits')) result = { sha: 'new-commit' };
    else if (path.endsWith('/git/refs')) result = {};
    else if (path.endsWith('/pulls')) result = { number: 123, state: 'open', merged_at: null };
    else throw new Error(`Unexpected request ${url}`);
    return Response.json(result);
  });
  const response = await onRequest(context({ slug: 'agdur', scene: draft, baseScene: scene }) as never);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).number, 123);
  assert.ok(calls.every(call => call.method !== 'PATCH'));
  const ref = calls.find(call => call.path.endsWith('/git/refs'))!;
  assert.match(String(ref.body.ref), /^refs\/heads\/codex\/illustration-agdur-/);
  const tree = calls.find(call => call.path.endsWith('/git/trees'))!.body.tree as { path: string; content: string }[];
  assert.equal(tree.length, 2);
  assert.equal(JSON.parse(tree[1].content).diagram, '/legacy.png');
  assert.equal(JSON.parse(tree[1].content).illustration, 'agdur');
});

test('stale editors cannot overwrite a newer illustration', async t => {
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(init.method, 'GET');
    if (url.includes('/git/ref/')) return Response.json({ object: { sha: 'base' } });
    if (url.includes('/tricks/')) return Response.json(contents({ slug: 'agdur', illustration: 'agdur' }));
    if (url.includes('/illustrations/')) return Response.json(contents({ ...scene, published: !scene.published }));
    return Response.json([]);
  });
  const response = await onRequest(context({ slug: 'agdur', scene: draft, baseScene: scene }) as never);
  assert.equal(response.status, 409);
});

test('retry returns existing review without a second mutation', async t => {
  t.mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
    assert.equal(init.method, 'GET');
    if (url.includes('/git/ref/')) return Response.json({ object: { sha: 'base' } });
    if (url.includes('/tricks/')) return Response.json(contents({ slug: 'agdur', illustration: 'agdur' }));
    if (url.includes('/illustrations/')) return Response.json(contents(scene));
    return Response.json([{ number: 44, state: 'open', merged_at: null }]);
  });
  const response = await onRequest(context({ slug: 'agdur', scene: draft, baseScene: scene }) as never);
  assert.equal((await response.json()).number, 44);
});
