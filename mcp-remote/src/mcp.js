/**
 * Minimal stateless Streamable-HTTP MCP endpoint (no SSE, no sessions —
 * every POST is a self-contained JSON-RPC call, answered as plain JSON,
 * which the spec explicitly permits). Implements the handful of methods
 * MCP clients actually use: initialize, ping, tools/list, tools/call.
 */
import { dbTools } from './tools/dbtools.js';
import { contentTools } from './tools/contenttools.js';

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'puck-no-admin-remote', version: '1.0.0' };

export const TOOLS = [...contentTools, ...dbTools];
const byName = new Map(TOOLS.map((t) => [t.name, t]));

const jsonRpc = (id, result) => ({ jsonrpc: '2.0', id, result });
const jsonRpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

const respond = (payload, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

async function handleMessage(msg, env, user) {
  const { id, method, params } = msg;

  if (method === 'initialize') {
    const requested = params?.protocolVersion;
    return jsonRpc(id, {
      // Speak the client's version when we recognize it, else our latest.
      protocolVersion: ['2025-06-18', '2025-03-26', '2024-11-05'].includes(requested)
        ? requested
        : PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: SERVER_INFO,
      instructions:
        'Admin-verktøy for puck.no. Ødeleggende verktøy (delete_registration) kjører dry-run som standard — vis alltid forhåndsvisningen til brukeren før du sletter.',
    });
  }
  if (method === 'ping') return jsonRpc(id, {});
  if (method === 'tools/list') {
    return jsonRpc(id, {
      tools: TOOLS.map((t) => ({
        name: t.name,
        title: t.title,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    });
  }
  if (method === 'tools/call') {
    const tool = byName.get(params?.name);
    if (!tool) return jsonRpcError(id, -32602, `Unknown tool: ${params?.name}`);
    const args = params.arguments ?? {};
    console.log(JSON.stringify({ event: 'tool_call', user, tool: tool.name, args: auditSafe(args) }));
    try {
      const [summary, data] = await tool.run(env, args);
      const text = data !== undefined ? `${summary}\n\n${JSON.stringify(data, null, 2)}` : summary;
      return jsonRpc(id, { content: [{ type: 'text', text }], isError: false });
    } catch (err) {
      return jsonRpc(id, {
        content: [{ type: 'text', text: `Feil: ${err.message ?? err}` }],
        isError: true,
      });
    }
  }
  if (id === undefined || id === null) return null; // notification we don't care about
  return jsonRpcError(id, -32601, `Method not found: ${method}`);
}

/** Strip large/sensitive arg values from the audit log. */
function auditSafe(args) {
  const out = {};
  for (const [k, v] of Object.entries(args ?? {})) {
    if (/body|content|base64|file/i.test(k)) out[k] = `<${typeof v === 'string' ? `${v.length} chars` : 'data'}>`;
    else if (/email|phone/i.test(k)) out[k] = '***';
    else out[k] = v;
  }
  return out;
}

export async function handleMcp(request, env, user) {
  if (request.method === 'GET' || request.method === 'DELETE') {
    // Stateless: no SSE stream / no session to terminate.
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
  }
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } });
  }

  let msg;
  try {
    msg = await request.json();
  } catch {
    return respond(jsonRpcError(null, -32700, 'Parse error'), 400);
  }
  if (Array.isArray(msg)) {
    return respond(jsonRpcError(null, -32600, 'Batch requests are not supported'), 400);
  }
  if (typeof msg?.method !== 'string') {
    return respond(jsonRpcError(msg?.id ?? null, -32600, 'Invalid Request'), 400);
  }

  // Notifications (no id) get 202 with an empty body.
  if (msg.id === undefined || msg.id === null || msg.method.startsWith('notifications/')) {
    return new Response(null, { status: 202 });
  }

  const result = await handleMessage(msg, env, user);
  if (result == null) return new Response(null, { status: 202 });
  return respond(result);
}
