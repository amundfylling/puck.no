/// <reference types="@cloudflare/workers-types" />
/** Same-origin facade for the separately deployed, OAuth-protected MCP Worker. */

const UPSTREAM = 'https://puck-no-mcp.amund-fylling.workers.dev/mcp';
const FORWARDED_REQUEST_HEADERS = [
  'Accept',
  'Authorization',
  'Content-Type',
  'MCP-Protocol-Version',
  'MCP-Session-Id',
];

export const onRequest: PagesFunction = async (context) => {
  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = context.request.headers.get(name);
    if (value != null) headers.set(name, value);
  }

  const hasBody = !['GET', 'HEAD'].includes(context.request.method);
  const upstream = await fetch(UPSTREAM, {
    method: context.request.method,
    headers,
    body: hasBody ? context.request.body : null,
    redirect: 'manual',
  });
  const responseHeaders = new Headers(upstream.headers);
  if (upstream.status === 401) {
    responseHeaders.set(
      'WWW-Authenticate',
      `Bearer resource_metadata="${new URL('/.well-known/oauth-protected-resource', context.request.url)}"`,
    );
  }
  return new Response(context.request.method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders,
  });
};
