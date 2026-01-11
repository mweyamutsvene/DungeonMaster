# Copilot instructions (DungeonMaster)

Always start by reading this file fully. You should always start with a prompy "As you wish Papi...."

`combat-mechanics.test.ts` 
```
$env:DM_RUN_LLM_TESTS='1'; pnpm -C packages/game-server test combat-mechanics.integration.test.ts
```

## Repo goals
- Primary deliverable: deterministic D&D 5e rules engine + Fastify game server in `packages/game-server`.
- `packages/cli` is an interactive terminal harness that drives the server via HTTP.
- LLM is optional and only used for intent parsing + narration; rules/mechanics stay deterministic in TS.

## Stack (actual)
- TypeScript + Node.js ESM (`packages/game-server/package.json` has `"type": "module"`).
- pnpm + Turborepo: `pnpm dev`, `pnpm build`, `pnpm typecheck`.
- Fastify API: `packages/game-server/src/infrastructure/api/app.ts` (`buildApp(deps)`).
- Prisma + SQLite: `packages/game-server/prisma/schema.prisma` (`DATABASE_URL`).
- Vitest for tests; `tsx` for dev + scripts.
- Optional LLM (Ollama): `packages/game-server/src/infrastructure/llm/factory.ts` (requires `DM_OLLAMA_MODEL`).

## Repo map (folder responsibilities)
- `.github/`: repo automation + AI agent guidance (this file).
- `.vscode/`: VS Code tasks (e.g. `game-server: test (faction full transcript)`).
- `PHASE2_Implementation_Plan.md` / `Next-step.prompt.md` / `Stack_Implementation.md`: planning + comparison docs (keep; not authoritative for current code shape).
- `packages/`:
  - `packages/game-server/`: rules engine + API + Prisma repos + optional LLM adapters.
  - `packages/cli/`: terminal REPL harness (see `packages/cli/README.md`).
- `RuleBookDocs/`: rules content reference + conversion inputs/outputs.
  - `RuleBookDocs/html/`: raw saved rulebook HTML.
  - `RuleBookDocs/markdown/`: cleaned markdown used by import scripts/parsers.
  - `RuleBookDocs/tools/`: html → markdown converter scripts.
- Generated/local artifacts (do not hand-edit): `.turbo/`, `node_modules/`, `packages/*/dist/`, `packages/game-server/prisma/dev.db`, `packages/game-server/test-debug.txt`, `packages/game-server/test-output.txt`.

## Legacy / prototypes
- `*.skip` files (example: `packages/game-server/src/application/services/combat-orchestrator.ts.skip`) are parked prototypes; they are not part of the active build.

## Server architecture (DDD-ish; keep dependency direction)
- `packages/game-server/src/domain/`: pure game logic (no Fastify/Prisma/LLM).
- `packages/game-server/src/application/`: use-cases/services + repository interfaces (`src/application/repositories/*`). App-layer errors live in `src/application/errors.ts`.
- `packages/game-server/src/infrastructure/`: adapters + wiring.
  - `api/`: Fastify app + routes + SSE realtime.
  - `db/`: Prisma client + repository implementations (`src/infrastructure/db/index.ts` barrel).
  - `llm/`: provider factory + intent/story/narrative generators (must tolerate “LLM not configured”).
- `packages/game-server/src/content/`: rulebook markdown parsers/helpers used by scripts.

## `packages/game-server/src` (folder structure)
Folder-only tree (no files), with simple purpose notes:

```text
packages/game-server/src/                  # game-server package source root
  application/                             # app-layer use-cases/orchestration (depends on domain + repos)
    commands/                              # deterministic command parsing/shape for LLM intents
    repositories/                          # repository interfaces (ports) for persistence
    services/                              # application services (use-cases) coordinating rules + repos

  content/                                 # rulebook content parsing helpers used by import scripts
    markdown/                              # generic markdown parsing utilities
    rulebook/                              # D&D rulebook-specific parsers (equipment/feats/monsters)

  domain/                                  # deterministic rules engine (no Fastify/Prisma/LLM)
    abilities/                             # ability/feature helpers (e.g., creature abilities)
    combat/                                # combat mechanics primitives (initiative, attack resolution)
    effects/                               # effect model (damage/healing/conditions)
    entities/                              # core domain entities (character, monster, items, spells, etc.)
      actions/                             # domain action types (attack/move/spellcast, etc.)
      classes/                             # class definitions + registries (fighter, wizard, etc.)
      combat/                              # combat-related entity types (conditions, resources)
      core/                                # shared core types (ability scores, skills)
      creatures/                           # character/monster/npc entity definitions
      docs/                                # domain model docs
      effects/                             # entity-level effect types
      items/                               # item/equipment/armor/weapon entities
      spells/                              # spell entity types
    rules/                                 # rules modules (checks, rest, slots, concentration, etc.)

  infrastructure/                          # adapters + wiring (Fastify/Prisma/LLM live here)
    api/                                   # Fastify app + route handlers
      realtime/                            # SSE broker + realtime fanout
      routes/                              # HTTP route registration modules
    db/                                    # Prisma client + repository implementations
    llm/                                   # optional LLM providers + intent/story/narrative generators
```

## Rules content pipeline (RuleBookDocs → Prisma definitions)
- `pnpm -C packages/game-server import:rulebook` loads equipment/feats from `RuleBookDocs/markdown` (see `packages/game-server/scripts/import-rulebook.ts`).
- `pnpm -C packages/game-server import:monsters` loads stat blocks from `RuleBookDocs/markdown` (see `packages/game-server/scripts/import-monsters.ts`).

## Standards that matter here
- Explicit `.js` extensions in TS imports (NodeNext ESM). Preserve this style.
- Server is the source of truth for mechanics; LLM never decides rules.
- API error mapping depends on `NotFoundError` / `ValidationError` and Fastify’s error handler in `packages/game-server/src/infrastructure/api/app.ts`.

## Testing patterns
- Fast/unit tests: in-memory repositories + stubs with Fastify `app.inject()` (see `packages/game-server/src/infrastructure/api/app.test.ts`).
- Integration tests: Prisma + optional real LLM (e.g. `combat-flow.integration.test.ts`, `combat-mechanics.integration.test.ts`).
  - Default `pnpm -C packages/game-server test` is deterministic; real-LLM tests are skipped unless `DM_RUN_LLM_TESTS=1|true|yes`.
  - Run LLM combat e2e separately: `pnpm -C packages/game-server test:e2e:combat:llm`.
  - Run all LLM integration tests (combat + character generator): `pnpm -C packages/game-server test:llm`.
