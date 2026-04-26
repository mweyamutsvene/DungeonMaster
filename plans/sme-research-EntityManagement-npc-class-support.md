# SME Research — EntityManagement — NPC Class Support

## Scope
- Files read: `packages/game-server/src/application/types.ts` (1-94), `packages/game-server/src/application/repositories/npc-repository.ts` (1-18), `packages/game-server/src/infrastructure/db/npc-repository.ts` (1-68), `packages/game-server/src/infrastructure/testing/memory-repos.ts` (647-707), `packages/game-server/src/domain/entities/creatures/npc.ts` (1-31)
- Files read: `packages/game-server/src/infrastructure/api/routes/sessions/session-creatures.ts` (1-183), `packages/game-server/src/infrastructure/api/routes/sessions/session-crud.ts` (1-83), `packages/game-server/src/infrastructure/api/routes/sessions/session-characters.ts` (1-260), `packages/game-server/SESSION_API_REFERENCE.md` (1-260)
- Files read: `packages/game-server/src/application/services/combat/helpers/creature-hydration.ts` (1-412), `packages/game-server/src/application/services/combat/helpers/combatant-resolver.ts` (220-380), `packages/game-server/src/application/services/combat/helpers/creature-hydration.test.ts` (428-520)
- Files read: `packages/game-server/src/application/services/combat/tabletop/rolls/initiative-handler.ts` (330-380, 460-490, 626-642), `packages/player-cli/src/types.ts` (1-220, 340-440), `packages/player-cli/src/game-client.ts` (72-120), `packages/player-cli/src/scenario-loader.ts` (1-154), `packages/game-server/scripts/test-harness/scenario-runner.ts` (1-110, 840-890)
- Task context: assess how to support class-backed NPCs defined with `className`, `level`, and `sheet`, while preserving existing stat-block NPCs in session APIs and scenario setup.

## Current State
- `SessionNPCRecord` is stat-block-only today: `name`, `statBlock`, `faction`, and `aiControlled`. There is no parallel NPC `className`, `level`, or `sheet` contract in [packages/game-server/src/application/types.ts](../packages/game-server/src/application/types.ts).
- `INPCRepository` and every concrete test/prod adapter require `CreateNPCInput.statBlock` and expose `updateStatBlock()`. That bakes the stat-block shape into persistence and test doubles, not just the HTTP layer.
- `POST /sessions/:id/npcs` validates `statBlock` as required and writes directly to `npcsRepo`; unlike characters, NPC creation has no dedicated application service that can own representation branching or normalization.
- Hydration and combat resolution both assume NPCs are stat-block-backed. `hydrateNPC()` reads HP, AC, speed, PB, CR, and role from `record.statBlock`; `CombatantResolver` reads NPC stats and attacks from `n.statBlock` and throws if it is not an object.
- Downstream combat code also reads `npc.statBlock` inline for initiative/resources/willingness checks, so this is not isolated to repository shape alone.
- Scenario setup and the player CLI are also stat-block-only for NPCs. Both the CLI setup types and test harness scenario schema require `setup.npcs[].statBlock`, then POST that payload to `/sessions/:id/npcs`.

## Impact Analysis
| File | Change Required | Risk | Why |
|------|-----------------|------|-----|
| `packages/game-server/src/application/types.ts` | Expand `SessionNPCRecord` beyond stat-block-only | high | This is the root shared contract for repos, routes, hydration, tests, and clients |
| `packages/game-server/src/application/repositories/npc-repository.ts` | Replace stat-block-only create/update contract with a representation-aware input/update model | high | Current API forces `statBlock` and exposes a misleading `updateStatBlock()` surface |
| `packages/game-server/src/infrastructure/db/npc-repository.ts` | Persist new fields and preserve old rows | high | Prisma adapter and DB schema must stay aligned |
| `packages/game-server/src/infrastructure/testing/memory-repos.ts` and API/test fake repos | Mirror new interface | high | In-memory repos are a hard constraint whenever repo contracts change |
| `packages/game-server/prisma/schema.prisma` | Make NPC persistence representation-aware | high | Current model only stores `statBlock` JSON |
| `packages/game-server/src/infrastructure/api/routes/sessions/session-creatures.ts` | Accept either stat-block NPCs or class-backed NPCs and enforce invariants | high | Public API entry point currently rejects anything but `statBlock` |
| `packages/game-server/src/application/services/combat/helpers/creature-hydration.ts` | Branch NPC hydration by backing shape | high | Current helper assumes all NPC data lives in `statBlock` |
| `packages/game-server/src/application/services/combat/helpers/combatant-resolver.ts` | Resolve stats/attacks from NPC sheet when present | high | Combat stat resolution currently requires `n.statBlock` |
| `packages/game-server/src/application/services/combat/tabletop/rolls/initiative-handler.ts` | Stop reading NPC class/HP/conditions from `npc.statBlock` only | medium | Several initiative and ally-swap paths read NPC fields inline |
| `packages/player-cli/src/types.ts`, `packages/player-cli/src/game-client.ts`, `packages/player-cli/src/scenario-loader.ts`, `packages/game-server/scripts/test-harness/scenario-runner.ts` | Add union setup/client payload support | medium | Scenario and CLI callers currently cannot express class-backed NPCs |
| `packages/game-server/SESSION_API_REFERENCE.md` | Document union request/response shape | low | API docs currently describe NPCs as stat-block-only |

## Constraints & Invariants
- Preserve existing stat-block NPCs. Existing rows, scenarios, and API callers must continue to work without rewrites.
- Keep NPCs as NPCs. Reusing `SessionCharacterRecord` directly would blur persistence semantics, faction defaults, and API behavior unnecessarily.
- Repository changes must update Prisma adapters and in-memory repos together.
- Hydration must remain defensive over schemaless JSON. New NPC sheet support cannot assume generated-character completeness.
- Avoid a contract where both `statBlock` and `sheet` are silently accepted together without a clear invariant. The representation must be explicit and validated at the API/application boundary.

## Options & Tradeoffs
| Option | Pros | Cons | Recommendation |
|--------|------|------|---------------|
| A: Keep a single `statBlock` field and stuff `className`/`level`/sheet-like data inside it | Minimal schema churn | Keeps the root ambiguity, preserves misleading repo names, and forces more downstream special-casing on a field that no longer means stat block | ✗ Avoid |
| B: Reuse `SessionCharacterRecord`/character routes for class-backed NPCs | Reuses character enrichment path | Breaks the conceptual model of NPCs vs characters, complicates faction/AI/session API behavior, and risks broad ripple into character-only assumptions | ✗ Avoid |
| C: Extend `SessionNPCRecord` into a dual-shape contract with optional `statBlock` and optional `sheet` plus `className`/`level`, validated as exactly one backing representation | Preserves existing NPC identity and routes, supports backward compatibility, and gives a scalable typed contract for future NPC-specific behavior | Requires broad but coherent contract updates and downstream branching where code reads `npc.statBlock` directly | ✓ Preferred |

## Risks
1. Nullability migration risk: changing `SessionNPC.statBlock` from required to optional will break any code that assumes an object. Mitigation: update all `SessionNPCRecord` consumers in one pass, especially hydration/resolver/initiative/test doubles.
2. API ambiguity risk: accepting both `statBlock` and `sheet` without a strict XOR invariant will create hard-to-debug mixed NPCs. Mitigation: validate exactly one representation in the route or a new NPC application service.
3. Persistence drift risk: repo interface, Prisma adapter, memory repos, and test-local fake repos can easily diverge. Mitigation: treat repository updates as one unit of work and update all known implementations together.
4. Scenario/client drift risk: server support alone is insufficient because the test harness and player CLI currently construct NPC payloads from `statBlock` only. Mitigation: add a union `NPCSetup` / `addNpc` payload shape alongside backward-compatible stat-block support.
5. Hidden downstream readers: some combat/tabletop paths bypass hydration and inspect `npc.statBlock` directly. Mitigation: search for `npc.statBlock`/`SessionNPCRecord` usages and move those reads behind a shared helper or representation-aware branch.

## Recommendations
1. Make `SessionNPCRecord` representation-aware instead of overloading `statBlock`: add nullable `className`, nullable `level`, nullable `sheet`, and make `statBlock` nullable, with an application invariant that exactly one of `statBlock` or `sheet` is present.
2. Update `CreateNPCInput` to a discriminated union such as stat-block NPC vs class-backed NPC, and replace `updateStatBlock()` with a more honest NPC update API or keep it only for stat-block-backed NPCs.
3. Add a dedicated NPC creation/normalization layer in application code, mirroring the character path enough to centralize validation and future enrichment, instead of keeping branching logic in the route.
4. Reuse character-style sheet parsing for class-backed NPC hydration and combat stat resolution, but keep the persisted record and runtime identity as NPC so existing session/combat APIs remain stable.
5. Plan the rollout as a contract sweep: types -> repo interface -> Prisma schema/adapter -> memory repos/test doubles -> session NPC route -> hydration/resolver -> scenario/client types. That is the most scalable path because the current stat-block assumption is embedded at every layer.
