/**
 * Minimal stateless Streamable-HTTP MCP endpoint (no SSE, no sessions —
 * every POST is a self-contained JSON-RPC call, answered as plain JSON,
 * which the spec explicitly permits). Implements the handful of methods
 * MCP clients actually use: initialize, ping, tools/list, tools/call.
 */
import { dbTools } from './tools/dbtools.js';
import { contentTools } from './tools/contenttools.js';
import { ValidationError } from './lib/validate.js';
import { readTextLimited, RequestTooLargeError } from './lib/request.js';

const PROTOCOL_VERSION = '2025-06-18';
const SERVER_INFO = { name: 'puck-no-admin-remote', version: '1.0.0' };

export const TOOLS = [...contentTools, ...dbTools];
const byName = new Map(TOOLS.map((t) => [t.name, t]));

const jsonRpc = (id, result) => ({ jsonrpc: '2.0', id, result });
const jsonRpcError = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

const respond = (payload, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

function validateValue(value, schema, path = 'arguments', depth = 0) {
  if (depth > 8) return `${path} er for dypt nestet`;
  if (schema.enum && !schema.enum.some((candidate) => Object.is(candidate, value))) {
    return `${path} har en verdi som ikke er tillatt`;
  }
  if (!schema.type) return null;
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return `${path} må være et objekt`;
    for (const required of schema.required ?? []) {
      if (!(required in value)) return `${path}.${required} er påkrevd`;
    }
    const properties = schema.properties ?? {};
    for (const [key, child] of Object.entries(value)) {
      const childSchema = properties[key] ?? schema.additionalProperties;
      if (!childSchema) return `${path}.${key} er ikke et tillatt felt`;
      const error = validateValue(child, childSchema, `${path}.${key}`, depth + 1);
      if (error) return error;
    }
    return null;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return `${path} må være en liste`;
    if (value.length > (schema.maxItems ?? 100)) return `${path} har for mange elementer`;
    if (schema.minItems != null && value.length < schema.minItems) return `${path} har for få elementer`;
    for (let index = 0; index < value.length; index++) {
      const error = validateValue(value[index], schema.items ?? {}, `${path}[${index}]`, depth + 1);
      if (error) return error;
    }
    return null;
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') return `${path} må være tekst`;
    if (value.length > (schema.maxLength ?? 500_000)) return `${path} er for lang`;
    if (schema.minLength != null && value.length < schema.minLength) return `${path} er for kort`;
    return null;
  }
  if (schema.type === 'integer') {
    if (!Number.isSafeInteger(value)) return `${path} må være et heltall`;
  } else if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return `${path} må være et tall`;
  } else if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') return `${path} må være sann/usann`;
    return null;
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) return `${path} er for liten`;
    if (schema.maximum != null && value > schema.maximum) return `${path} er for stor`;
  }
  return null;
}

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
    const validationError = validateValue(args, tool.inputSchema);
    if (validationError) return jsonRpcError(id, -32602, validationError);
    console.log(JSON.stringify({ event: 'tool_call', user, tool: tool.name, args: auditSafe(args) }));
    try {
      const [summary, data] = await tool.run(env, args);
      const text = data !== undefined ? `${summary}\n\n${JSON.stringify(data, null, 2)}` : summary;
      return jsonRpc(id, { content: [{ type: 'text', text }], isError: false });
    } catch (err) {
      const expected = err instanceof ValidationError;
      console.error(JSON.stringify({
        event: 'tool_error',
        user,
        tool: tool.name,
        kind: err?.constructor?.name ?? 'Error',
        status: Number.isInteger(err?.status) ? err.status : undefined,
      }));
      return jsonRpc(id, {
        content: [{
          type: 'text',
          text: expected
            ? `Feil: ${err.message}`
            : 'Feil: Operasjonen kunne ikke fullføres trygt. Sjekk Worker-loggen og gjeldende status før du prøver igjen.',
        }],
        isError: true,
      });
    }
  }
  if (id === undefined || id === null) return null; // notification we don't care about
  return jsonRpcError(id, -32601, `Method not found: ${method}`);
}

/** Strip large/sensitive arg values from the audit log. */
export function auditSafe(value, key = '', depth = 0) {
  const fullySensitive =
    /answer|email|phone|token|secret|password|credential|authorization|cookie/i.test(key) ||
    /^(?:name|names|query)$/i.test(key);
  const largeContent = /body|content|base64|file/i.test(key);
  if (fullySensitive || largeContent) {
    return typeof value === 'string' && !fullySensitive ? `<${value.length} chars>` : '***';
  }
  if (depth > 6) return '<nested data>';
  if (Array.isArray(value)) return value.map((item) => auditSafe(item, key, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [childKey, auditSafe(child, childKey, depth + 1)]),
    );
  }
  return value;
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
    msg = JSON.parse(await readTextLimited(request, 1024 * 1024));
  } catch (error) {
    if (error instanceof RequestTooLargeError) {
      return respond(jsonRpcError(null, -32600, 'Request body too large'), 413);
    }
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
