import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onRequest } from '../mcp.ts';

test('MCP facade forwards only protocol headers and rewrites OAuth discovery on 401', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input, init) => {
      assert.equal(String(input), 'https://puck-no-mcp.amund-fylling.workers.dev/mcp');
      const headers = new Headers(init?.headers);
      assert.equal(headers.get('Authorization'), 'Bearer test');
      assert.equal(headers.get('Cookie'), null);
      assert.equal(headers.get('X-Private'), null);
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const response = await onRequest({
      request: new Request('https://www.puck.no/mcp', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer test',
          Cookie: 'session=private',
          'Content-Type': 'application/json',
          'X-Private': 'do-not-forward',
        },
        body: '{}',
      }),
    } as never);
    assert.equal(response.status, 401);
    assert.equal(
      response.headers.get('WWW-Authenticate'),
      'Bearer resource_metadata="https://www.puck.no/.well-known/oauth-protected-resource"',
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
