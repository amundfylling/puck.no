/** Shared MCP response helpers. */

/** Success: human summary + structured JSON payload. */
export function ok(summary, data) {
  const parts = [];
  if (summary) parts.push(summary);
  if (data !== undefined) parts.push(JSON.stringify(data, null, 2));
  return { content: [{ type: 'text', text: parts.join('\n\n') }] };
}

/** Failure (returned, not thrown, so the client sees the message). */
export function fail(err) {
  return { isError: true, content: [{ type: 'text', text: `Feil: ${err.message ?? err}` }] };
}

/** try/catch wrapper for tool handlers. */
export function tool(fn) {
  return async (args) => {
    try {
      return await fn(args);
    } catch (err) {
      return fail(err);
    }
  };
}
