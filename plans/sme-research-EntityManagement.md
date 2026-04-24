# SME Research — EntityManagement — Inventory Expansion (spell-created items, transfer, expiry, action cost)

## Scope
- Files read:
  - `packages/game-server/src/infrastructure/api/routes/sessions/session-inventory.ts` (~370 lines) — inventory HTTP endpoints
  - `packages/game-server/src/infrastructure/api/routes/sessions/session-characters.ts` (first 60 + UoW pattern)
  - `packages/game-server/src/infrastructure/api/routes/sessions/types.ts` (`SessionRouteDeps`, `createServicesForRepos`)
  - `packages/game-server/src/application/repositories/character-repository.ts` — `ICharacterRepository` interface
  - `packages/game-server/src/application/services/entities/character-service.ts` — `CharacterService` (addCharacter, updateCharacter, beginRest, takeSessionRest)
  - `packages/game-server/src/infrastructure/db/unit-of-work.ts` — `PrismaUnitOfWork`, `RepositoryBundle`
  - `packages/game-server/src/infrastructure/db/character-repository.ts` — `PrismaCharacterRepository`
  - `packages/game-server/src/application/services/combat/tabletop/dispatch/interaction-handlers.ts` (line 248 context)
  - `packages/game-server/src/infrastructure/api/app.test.ts` (inventory test block)
- Task: Ground-truth the current state of inventory persistence, atomic multi-character writes, and time/expiry hooks to inform a scalable design for spell-created items, party transfers, expiry timers, and action-economy-costed item use.

## Current State

### 1. `CharacterItemInstance[]` persistence
- **Storage**: inventory is a plain array on the character's **`sheet` JSON blob** (SQLite `SessionCharacter.sheet` column, Prisma `Json`). Accessed as `sheet.inventory`. There is **no separate inventory table or row-per-item model**.
- **Repo**: only `ICharacterRepository` touches it. Key method used is `updateSheet(id, sheet): Promise<SessionCharacterRecord>` which does a full-sheet replace (`prisma.sessionCharacter.update({ where:{id}, data:{sheet} })`).
- **Mutation pattern everywhere**: read full character → spread sheet → replace `sheet.inventory` (and optionally `currentHp`, `tempHp`) → `updateSheet(...)`. Pure functional helpers (`addInventoryItem`, `removeInventoryItem`, `useConsumableItem`, `useItemCharge`) in `domain/entities/items/inventory.ts` return new arrays; callers are responsible for writing back.
- **Service layer**: `CharacterService` does NOT expose inventory methods today. `session-inventory.ts` talks directly to `deps.charactersRepo` (bypasses `CharacterService`). This is a live architectural gap.
- **Combat-time parallel**: during combat, inventory is copied into combatant `resources` (see `combat-hydration`), separate from the sheet. In-combat item changes don't auto-persist back to sheet; `interaction-handlers.ts:248` is one of the few spots that does call `deps.characters.updateSheet(actorId, updatedSheet)` (drop/pickup flow) — and it's the only in-combat path that mutates sheet inventory.

### 2. Atomic two-character writes — current state
- **Infrastructure EXISTS**: `PrismaUnitOfWork.run(fn)` opens a `prisma.$transaction` and hands back a `RepositoryBundle` containing transaction-scoped repos (`charactersRepo`, `sessionsRepo`, `eventsRepo`, etc.). Two `updateSheet` calls inside the same `run()` commit atomically. Events inside the block are deferred via `DeferredPublishingEventRepository` and flushed only post-commit.
- **But no current flow updates two characters atomically in one transaction.** Closest analogs:
  - `CharacterService.takeSessionRest()` mutates N character sheets, collects them into `pendingUpdates[]`, then `Promise.all(pendingUpdates.map(u => characters.updateSheet(u.charId, u.sheet)))`. Comment at line ~220 explicitly notes: *"When called inside PrismaUnitOfWork.run(), these all execute within the same Prisma transaction. Outside UoW, Promise.all() ensures fail-fast behavior."* — rest is the precedent for multi-character writes but is NOT wrapped in a UoW when called from routes (check needed; route likely calls service directly).
  - `session-characters.ts` routes DO wrap `addCharacter`, character update, and generate-character flows in `deps.unitOfWork.run(...)` via `createServicesForRepos(repos)`.
  - `session-actions.ts` wraps programmatic actions in UoW.
- **`session-inventory.ts` does NOT use `deps.unitOfWork`** — every endpoint goes straight to `deps.charactersRepo.updateSheet(...)` outside any transaction. A transfer built on the existing routes would NOT be atomic without a refactor.

### 3. `session-inventory.ts` mutation pattern (per endpoint)
- All endpoints follow the same shape:
  1. `const char = await deps.charactersRepo.getById(charId)` + session scope check
  2. Read `sheet.inventory` via `getInventoryFromSheet(sheet)`
  3. Call a pure helper from `domain/entities/items/inventory.ts` to produce a new array
  4. For armor/shield equip changes: call `recomputeArmorFromInventory({ ...sheet, inventory: updated })` then `updateSheet(charId, enrichedSheet)`. Otherwise: `saveInventory()` which is `updateSheet(charId, { ...sheet, inventory })`.
  5. Emit `InventoryChanged` event (types: `add | remove | equip | use-charge | use`)
- **`/use` endpoint** is the only one that ALSO rolls dice (`deps.diceRoller`) and mutates `currentHp`/`tempHp` in the same sheet write — precedent for item-use side effects on the character sheet.
- No locking, no optimistic concurrency, no version field on the sheet — classic last-writer-wins.

### 4. Time / expiry infrastructure
- **No in-world game clock on character sheet or session.** Searched for `elapsed`, `gameTime`, `worldTime`, `inGameTime` — zero matches outside `PendingAction.expiresAt` (reaction timeout, real-world `Date`).
- **`expiresAt` exists** in two unrelated places only:
  - `PendingAction.expiresAt: Date` (real-world time, reaction windows ~30s).
  - Combat `Effect.duration` with `'permanent' | rounds | turns` and optional `expiresAt: { event: 'start_of_turn' | 'end_of_turn', combatantId }` — **in-combat only, round-based, not wall-clock, cleared when combat ends**.
- **Rest hooks**: `CharacterService.beginRest()` emits `RestStarted` event; `takeSessionRest()` detects interruptions via `detectRestInterruption()` reading events since start, then calls `refreshClassResourcePools()` and mutates each sheet once. This is the natural attachment point for "24-hour item expiry tied to long rest" — long rest is the only existing concept of "a day passes." There is no equivalent hook for arbitrary elapsed wall-time between rests.
- **Event bus** (`IEventRepository.listBySession({ since })`) can replay session events by date — could back an in-world clock if one is introduced, but none exists today.

### 5. Round-trip persistence tests
- `app.test.ts` lines ~3062–3186 — inventory API tests assert list → add → stack → delete → equip round-trips through the API using in-memory repos. These will fire on any schema change to `CharacterItemInstance` or to the `sheet.inventory` path.
- `character-service.test.ts` / rest tests cover `takeSessionRest` pool refresh and hit-dice persistence via sheet round-trip.
- No test today asserts **cross-character transactional rollback** (e.g., Alice loses item, Bob fails → Alice must be rolled back). That test currently cannot exist because no such flow exists.
- E2E scenarios in `scripts/test-harness/scenarios/` exercise combat-time inventory (drop/pickup, potion drink) via the tabletop action flow, not via `session-inventory` routes.

## Impact Analysis

| File | Change required to support new features | Risk | Why |
|------|-----------------------------------------|------|-----|
| `session-inventory.ts` | Must be refactored to go through a `CharacterService` / new `InventoryService` method AND opt into `deps.unitOfWork.run(...)` when a mutation spans 2+ characters (transfer, feed-ally). | **High** | Current direct-to-repo pattern makes atomic transfer impossible without duplicating UoW plumbing in the route. |
| `ICharacterRepository` | Probably sufficient as-is (`updateSheet` on both characters inside UoW). May want `updateManySheets(updates[])` for clarity, but not required. | Low | Existing `rest` flow shows N sheet writes in UoW already works. |
| `CharacterService` | Needs new inventory APIs (`transferItem`, `useItem`, `grantItems`) so routes can call service methods inside `unitOfWork.run`. Current service has no inventory surface. | Medium | This is the missing seam. Without it, all new features leak UoW plumbing into routes. |
| `sheet.inventory` JSON shape | To support expiry, items need an `expiresAt` / `createdAtRound?` / `sourceSpell?` / `magical: true` field on `CharacterItemInstance`. | Medium | Backward compat is easy (optional fields) but every consumer of `CharacterItemInstance` must tolerate them. |
| `takeSessionRest` | Natural hook to sweep `expiresAt`-past items from each sheet. Currently only refreshes pools + HP; would need to also filter `sheet.inventory`. | Low-Med | Straightforward; already does per-character sheet rewrite inside the loop. |
| Spell system (Goodberry) | Whatever service casts the spell must call `characters.grantItems(casterId, [...10 berries])` inside the same UoW the spell cast runs in. Cross-cuts SpellSystem flow. | Medium | Ensure the spell-handler and inventory mutation share a UoW. |
| `MagicItemDefinition` (scope: InventorySystem SME) | Needs an `activationCost: 'action' | 'bonus' | 'reaction' | 'free' | 'none'` field. From EntityManagement view: nothing new in persistence — this is static catalog data, not on the `CharacterItemInstance`. | Low | Static; SpellCatalog/InventorySystem SMEs own this. |
| In-memory repos (`memory-repos.ts`) | `updateSheet` already exists and works; no change required. UoW has no in-memory analog — tests that need atomic transfer will rely on the memory repos' direct mutation semantics (no rollback). | Medium | Any new integration test that wants to verify rollback behavior needs a real Prisma test DB or a fake UoW. |
| `app.test.ts` inventory tests | Will need new tests for transfer atomicity, grant-items, use-with-action-cost, expiry sweep on long rest. | Low | Additive. |

## Constraints & Invariants

1. **The sheet is the single source of truth for out-of-combat inventory.** Any mutation must go through `charactersRepo.updateSheet` (full-sheet replace). Partial JSON updates are not supported by the repo contract.
2. **`PrismaUnitOfWork.run()` is the only transactional boundary.** Any multi-character mutation MUST be inside a single `run()` call or it is not atomic.
3. **Events emitted inside UoW are buffered** (`DeferredPublishingEventRepository`) and only published post-commit. Transfer's `InventoryChanged` events must be emitted through the UoW-scoped `eventsRepo` to avoid publishing events for a rolled-back transaction.
4. **Combat-time inventory mutates `combatant.resources`, not `sheet`.** In-combat item use must decide whether to persist to sheet immediately (`interaction-handlers.ts:248` precedent) or defer until combat ends.
5. **No in-world clock exists.** Any expiry model that is not tied to `rounds`/`turns` (combat) or `long rest` (session-level "a day passed") requires introducing a new concept. Minimal viable: piggyback on long rest.
6. **`CharacterService` bypass is a real gap.** `session-inventory.ts` talks directly to the repo — new features should funnel through a service to enforce validation, events, and UoW wrapping consistently.
7. **Last-writer-wins.** No sheet version/ETag. Concurrent writes silently clobber.

## Risks

1. **Transfer-atomicity silent failure**: if we implement transfer inside `session-inventory.ts` without routing through `deps.unitOfWork`, a crash between Alice's `updateSheet` and Bob's will duplicate or delete items. Mitigation: forbid repo calls from the route; add `CharacterService.transferItem(...)` and route wraps in `unitOfWork.run`.
2. **Event leakage on rollback**: if the route emits `InventoryChanged` via `deps.events` (non-deferred) before commit, a rolled-back transfer still publishes events. Mitigation: always use UoW-scoped `eventsRepo` (via `createServicesForRepos(repos)`).
3. **Combat ↔ sheet divergence for expiry**: Goodberries created mid-combat live on `combatant.resources`, not sheet. If combat ends and the berry array isn't synced back, expiry sweep on long rest won't see them. Need an explicit sync-back or write-through on creation.
4. **Schema drift on `CharacterItemInstance`**: adding `expiresAt`/`sourceSpell`/`createdAt` fields touches every place that spreads the item (`session-inventory.ts` PATCH handler uses `{...i, ...(fields)}` which preserves unknowns — safe). But comparison-by-name in helpers (`findInventoryItem`) may merge items that should stay separate (two Goodberry stacks with different expiry). **Stacking logic needs to be expiry-aware or disabled for perishables.**
5. **In-memory repo tests can't prove atomicity.** `memory-repos.ts` has no transactional semantics; `PrismaUnitOfWork` is Prisma-only. Transfer rollback tests need either a fake UoW that tracks a snapshot or a real SQLite test DB.
6. **`hitDiceRemaining` precedent shows sheet-level persistence of mutable state works** (stored on sheet, updated by `takeSessionRest`). Expiry timers can follow the same pattern.
7. **`action.use` activation cost** is fundamentally an ActionEconomy + InventorySystem concern — EntityManagement just needs to ensure the persisted `CharacterItemInstance` carries enough data to resolve the cost from the static `MagicItemDefinition` lookup. No new persistence field required on the instance itself.

## Recommendations (for orchestrator)

1. **Route inventory through `CharacterService`** — add inventory methods (`grantItems`, `removeItems`, `transferItem`, `useItem`) and make `session-inventory.ts` a thin HTTP layer that wraps each mutating call in `deps.unitOfWork.run(repos => deps.createServicesForRepos(repos).characters.<method>(...))`. Mirrors `session-characters.ts` pattern.
2. **Model expiry at sheet level**, swept on `takeSessionRest` (long rest). Add optional `expiresAt?: { restsRemaining: number } | { createdAtSessionEvent: string }` to `CharacterItemInstance`. For Goodberry's 24-hour duration, `restsRemaining: 1` decrementing on long rest is the minimal, honest model given there is no wall-clock.
3. **Disable stacking for items with expiry** — `addInventoryItem`'s name-match stack must check that two stacks share the same `expiresAt` (or be absent) before merging. Otherwise preserve as separate stacks.
4. **Spell-created items use UoW** — whatever casts Goodberry grants items via the same `unitOfWork.run` scope as the spell cast so slot consumption + item grant commit together.
5. **Leave `MagicItemDefinition.activationCost` to InventorySystem SME**; EntityManagement persistence is unaffected (activation cost is static catalog data).
6. **Sync combat-created items to sheet on creation**, not on combat end, to keep long-rest expiry sweep authoritative.
7. **Add an in-memory UoW stub** in `infrastructure/testing/` so rollback tests become writable; otherwise atomicity is only provable via real-DB integration tests.
