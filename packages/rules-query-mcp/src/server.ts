/**
 * MCP stdio server: dnd-rules-query
 *
 * Exposes read-only queries over the deterministic D&D 5e 2024 rules engine
 * to any agentic tool that supports MCP (Claude Code, GitHub Copilot agent
 * mode, etc.). Registered in mcp.json at the repo root.
 *
 * Tools are implemented in src/tools/<tool-name>.ts. Each exports a tool
 * descriptor (name + description + JSON schema) and a handler function.
 *
 * Run: `pnpm -C packages/rules-query-mcp start`
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { lookupSpellTool, lookupSpell } from './tools/lookup-spell.js';
import { listSpellsByClassTool, listSpellsByClassFn } from './tools/list-spells-by-class.js';

const server = new Server(
  { name: 'dnd-rules-query', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

const tools = [lookupSpellTool, listSpellsByClassTool];

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const safeArgs = (args ?? {}) as Record<string, unknown>;
  let result: unknown;

  switch (name) {
    case 'lookup_spell':
      result = lookupSpell(safeArgs as { name: string });
      break;
    case 'list_spells_by_class':
      result = listSpellsByClassFn(safeArgs as { classId: string; level?: number });
      break;
    default:
      throw new Error(`Unknown tool: ${name}`);
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
