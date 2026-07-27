#!/usr/bin/env node
/**
 * puck-no-admin MCP server — local stdio server for puck.no admin tasks
 * (tournaments, registrations, content, ops). Wraps the local git clone
 * and `wrangler d1` — nothing is deployed; the site architecture is
 * untouched. See mcp/README.md for setup.
 *
 * IMPORTANT: stdout is the MCP protocol channel — log only to stderr.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerTournamentTools } from './tools/tournaments.js';
import { registerRegistrationTools } from './tools/registrations.js';
import { registerContentTools } from './tools/content.js';
import { registerOpsTools } from './tools/ops.js';

const server = new McpServer({
  name: 'puck-no-admin',
  version: '1.0.0',
});

registerTournamentTools(server);
registerRegistrationTools(server);
registerContentTools(server);
registerOpsTools(server);

await server.connect(new StdioServerTransport());
console.error('puck-no-admin MCP server running on stdio');
