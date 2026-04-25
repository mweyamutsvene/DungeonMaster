# SME Research — EntityManagement — Doc Accuracy Check

## Scope
- Compared `.github/instructions/entity-management.instructions.md` and `packages/game-server/src/application/services/entities/CLAUDE.md` against current in-scope code.
- Read: `packages/game-server/src/application/services/entities/{index,character-service,game-session-service,spell-lookup-service,item-lookup-service,inventory-service}.ts`, `packages/game-server/src/application/repositories/{index,character-repository,game-session-repository,event-repository,spell-repository,item-definition-repository,monster-repository,npc-repository}.ts`, `packages/game-server/src/application/types.ts`, `packages/game-server/src/domain/entities/creatures/{creature,character,monster,npc}.ts`, `packages/game-server/src/infrastructure/db/{unit-of-work,event-repository,publishing-event-repository,deferred-publishing-event-repository,character-repository}.ts`, `packages/game-server/src/infrastructure/testing/memory-repos.ts`, and adjacent route `packages/game-server/src/infrastructure/api/routes/sessions/session-creatures.ts`.

## Current Truth
- The application-layer EntityManagement services are `CharacterService`, `GameSessionService`, `SpellLookupService`, `ItemLookupService`, and `InventoryService`.
- `CharacterService` owns character add/list/get/update/delete plus rest flows (`beginRest`, `takeSessionRest`). Its add path enriches class features, weapon attacks, and armor metadata before persistence.
- `GameSessionService` owns session create/get/delete/list. It does not expose a generic `fireEvent()` API.
- `SpellLookupService` is read-only and now prefers the canonical spell catalog first, then falls back to `ISpellRepository`.
- Monster and NPC persistence exists through repository interfaces and Prisma/memory implementations, but there is no dedicated `MonsterService` or `NPCService` under `services/entities/`. Session routes use repos directly, optionally inside `PrismaUnitOfWork`.
- `ItemLookupService` and `InventoryService` are now real EntityManagement services and should be named in the flow docs.
- `PrismaUnitOfWork` now builds a 9-repository bundle: sessions, characters, monsters, NPCs, combat, events, spells, item definitions, and pending actions.
- `application/types.ts` is part of the flow contract surface. `SessionCharacterRecord` includes `sheetVersion`, `faction`, and `aiControlled`; `ItemDefinitionRecord` is also part of the shared record model.
- The event system doc is stale if it names a fixed list/count. `GameEventInput` currently contains 41 variants, including newer entity and reaction/combat events such as `SessionDeleted`, `CharacterUpdated`, `CharacterDeleted`, `InventoryChanged`, `CuttingWords`, `UncannyDodge`, `LegendaryAction`, `LairAction`, `ProtectionApplied`, and `InterceptionApplied`.

## Drift Findings
| Doc | Drift | Why it is inaccurate now |
|---|---|---|
| `.github/instructions/entity-management.instructions.md` | Purpose section is too broad and partially mis-scoped | It says the flow handles CRUD for monsters, NPCs, and items/equipment as if they are all service-owned here. In current code, characters/sessions/spells/items/inventory have services, but monster/NPC lifecycle is mostly repo- and route-driven, and static item catalogs live under InventorySystem-owned code. |
| `.github/instructions/entity-management.instructions.md` | Key Contracts table is stale | It names `CharacterService.createCharacter/getCharacter/updateResources`, `GameSessionService.fireEvent`, and `SpellLookupService.getAvailableSpells`, but those methods do not exist. |
| `.github/instructions/entity-management.instructions.md` | Missing current service contracts | `ItemLookupService` and `InventoryService` are exported from `services/entities/index.ts` and should be part of the flow description. |
| `.github/instructions/entity-management.instructions.md` | Unit of Work section is stale | It says `RepositoryBundle` contains 7 repos; current `PrismaUnitOfWork` builds 9, including item definitions and pending actions. |
| `.github/instructions/entity-management.instructions.md` | Event system section is stale and risky | The fixed "26 event types" list is outdated; the union has grown materially. A hard-coded list here will keep drifting. |
| `.github/instructions/entity-management.instructions.md` | Large Items & Equipment section is misleading in this flow doc | It documents static catalogs and inventory internals in detail even though the instruction header already points item work to `inventory-system.instructions.md`. The useful EntityManagement part is the service boundary (`ItemLookupService` / `InventoryService`), not the catalog deep dive. |
| `packages/game-server/src/application/services/entities/CLAUDE.md` | Too thin for current flow surface | The laws are mostly still true, but the file no longer tells readers that item lookup/inventory are in-scope application services, that `application/types.ts` is part of the contract, or that monster/NPC lifecycle is often route + repo + UoW driven rather than service-driven. |

## Recommended Doc Edits

### `.github/instructions/entity-management.instructions.md`

Replace the `## Purpose` section with this regular-English wording:

> EntityManagement owns the persistence-facing application contracts for sessions, characters, spell lookup, item lookup, inventory mutations, repository interfaces, shared record types, and creature entity models. Character lifecycle is service-led through `CharacterService`; session lifecycle is service-led through `GameSessionService`; spell and item lookup are read-oriented services. Monster and NPC lifecycle is part of the flow's persistence surface, but today it is mostly exercised through repository interfaces and session routes rather than dedicated application services. Hydration depends on these record and entity shapes, but the hydration logic itself lives in adjacent CreatureHydration helpers.

Replace the `## Key Contracts` table with this regular-English wording:

> Key contracts in this flow:
>
> - `CharacterService` (`services/entities/character-service.ts`): add/list/get/update/delete characters, enrich sheets before persistence, and run rest flows.
> - `GameSessionService` (`services/entities/game-session-service.ts`): create/get/delete/list sessions.
> - `SpellLookupService` (`services/entities/spell-lookup-service.ts`): read-only spell lookup, canonical catalog first and repository fallback second.
> - `ItemLookupService` (`services/entities/item-lookup-service.ts`): unified equipment lookup across stored magic items and static weapon/armor catalogs.
> - `InventoryService` (`services/entities/inventory-service.ts`): transactional inventory transfer, item creation, expiry sweep, and long-rest inventory updates.
> - `Character`, `Monster`, `NPC`, and `Creature` (`domain/entities/creatures/*`): runtime domain models whose shapes must stay compatible with hydration.
> - Repository interfaces (`application/repositories/*`), record types (`application/types.ts`), Prisma adapters (`infrastructure/db/*`), and memory adapters (`infrastructure/testing/memory-repos.ts`): the persistence contract surface for this flow.

Replace the `## Event System` intro with this regular-English wording:

> Treat `GameEventInput` in `application/repositories/event-repository.ts` as the source of truth for event types and payloads. Do not document a fixed event count here. This flow is responsible for keeping repository payload contracts, Prisma persistence, SSE publishing decorators, and memory-test implementations aligned when event shapes change.

Replace the `## Unit of Work` bullet list with this regular-English wording:

> `PrismaUnitOfWork.run()` creates a transactional repository bundle and swaps the event repository for `DeferredPublishingEventRepository` so SSE fanout happens only after commit. The current bundle includes sessions, characters, monsters, NPCs, combat, events, spells, item definitions, and pending actions. If a repository contract changes, update the Prisma bundle, the memory repos, and any callers that depend on the bundle shape.

Replace the detailed `## Items & Equipment` section with this regular-English wording:

> EntityManagement should document item behavior only at the service boundary: `ItemLookupService` and `InventoryService` live in this flow, while static item catalogs and inventory domain helpers are documented in `inventory-system.instructions.md`. Keep this doc focused on application contracts and persistence boundaries rather than repeating catalog contents.

Add this regular-English note near `## Record Types`:

> `application/types.ts` is part of the flow contract. In particular, `SessionCharacterRecord` carries `sheetVersion`, `faction`, and `aiControlled`, and `ItemDefinitionRecord` belongs to the shared persistence model alongside session, creature, combat, event, and spell records.

### `packages/game-server/src/application/services/entities/CLAUDE.md`

Suggested caveman-style replacement for the `## Scope` block:

> `services/entities/*`, `domain/entities/creatures/*`, `application/repositories/*`, `application/types.ts`, `infrastructure/db/*`, `infrastructure/testing/memory-repos.ts`.

Suggested caveman-style addition under `## Laws`:

> 5. Character and session use services. Monster and NPC often go route -> repo -> UoW. No fake service story.
>
> 6. Item lookup and inventory live here as app services. Static item catalogs live in InventorySystem docs.
>
> 7. If record shape changes, fix `application/types.ts`, Prisma repos, and memory repos together.

### Mermaid

Mermaid would not materially help the flow doc in its current state. The existing diagram is detailed enough to drift and already hides the real ownership boundaries. A short contract table is more useful. If a diagram is kept at all, it should be a very small ownership diagram showing `services/entities/*` -> repository interfaces -> Prisma/memory adapters, with a side note that monster/NPC routes often call repos/UoW directly.