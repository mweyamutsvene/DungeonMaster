# `@dungeonmaster/rules-query-mcp`

MCP stdio server exposing read-only queries over the deterministic D&D rules engine. Consumed by both Claude Code and GitHub Copilot via [mcp.json](../../mcp.json) at the repo root.

## Why

SMEs spend a lot of time grep'ing through `domain/entities/spells/`, `domain/entities/classes/`, and combat resolvers to look up rule data. This server exposes those lookups as structured tool calls, replacing grep + read + guess with `lookup_spell("fireball")` returning the canonical entry.

## Tools (v1)

| Tool | Input | Output |
|------|-------|--------|
| `lookup_spell` | `{ name: string }` | full canonical spell entry or `null` |
| `list_spells_by_class` | `{ classId: string, level?: number }` | array of spells available to that class, optionally level-filtered |

Planned (not yet implemented):
- `lookup_class_feature` — class + level → feature list with executor names + registration sites
- `simulate_attack` — attacker + target + weapon → resolved roll + damage + condition applications
- `check_concentration` — entity + incoming effect → break/save outcome
- `query_creature` — creature id → stat block + current state
- `get_ac_mods` — entity + attack type → total AC with stacking rules
- `list_conditions` — entity → active conditions + duration + source

## Setup

1. Install dependencies:
   ```bash
   pnpm install
   ```
2. Confirm registered in [mcp.json](../../mcp.json) (already done).
3. Restart Claude Code / Copilot to pick up the server.

## Run standalone (for testing)

```bash
pnpm -C packages/rules-query-mcp start
```

The server speaks MCP over stdio. Use any MCP client to test (e.g. `npx @modelcontextprotocol/inspector pnpm -C packages/rules-query-mcp start`).

## Adding a new tool

1. Create `src/tools/<tool-name>.ts` exporting:
   - `<toolName>Tool` — descriptor with `name`, `description`, `inputSchema`
   - A handler function returning the JSON result
2. If it needs data outside the spell catalog, add a sibling bridge file in `src/` rather than reaching into `game-server` from each tool.
3. Register in `src/server.ts`: add to the `tools` array and the `switch` in the call handler.
4. Test with the MCP Inspector: `npx @modelcontextprotocol/inspector pnpm -C packages/rules-query-mcp start`.

## Hard rules

- **Read-only.** Tools query state and rules. They NEVER mutate game state. Mutations go through the regular Fastify routes — this server is for SMEs and design-time research only.
- **Wrap, don't reimplement.** Each tool calls into `@dungeonmaster/game-server` source via the bridge module. If you find yourself porting logic, stop — the engine is the source of truth.
