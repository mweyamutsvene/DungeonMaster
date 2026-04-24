# SME Feedback — EntityManagement — Round 1
## Verdict: NEEDS_WORK

The overall direction (InventoryService behind UoW, post-commit events, `longRestsRemaining` as the expiry anchor, stack-key extension) is sound and consistent with existing EntityManagement patterns (`session-characters.ts`, `session-combat.ts`, `character-service.ts` collecting pending updates and flushing under `PrismaUnitOfWork.run`). A few architectural gaps will cause real bugs if implemented as-written.

## Issues

1. **UoW re-entrancy contract for `InventoryService` is undefined.**
   `createItemsForCharacter` is called from `SpellActionHandler.execute()` (mid-combat), and `sweepExpiredItems` is called from `takeSessionRest` (already collecting pending updates for a parent UoW flush). If these methods start their own `unitOfWork.run()`, they will either nest a Prisma transaction (Prisma rejects) or silently bypass the parent txn. This is the exact hazard `character-service.ts:218–223` documents for `takeSessionRest`.

2. **`sweepExpiredItems` invocation point is wrong.**
   Plan puts the call "inside the existing rest UoW" but `takeSessionRest` itself is not UoW-wrapped — the **route** (`session-characters.ts:170`) wraps it. If sweep is added in the route, it runs in a second round-trip after the rest sheet writes committed, breaking atomicity. Sweep must run inside `takeSessionRest` and push sheet updates into the same `pendingUpdates` batch that already flushes under the caller's UoW.

3. **No defined behavior for `transferItem` when `deps.unitOfWork` is absent.**
   Every other route in the codebase uses `if (deps.unitOfWork) { uow.run(...) } else { direct }` (see `session-characters.ts:113,170`, `session-combat.ts:49,70`). Memory tests run without a UoW today. Plan does not state what `transferItem` does in that path — non-atomic best-effort or hard-reject. Required for test scaffolding decisions.

4. **Memory-repo transactional semantics is equivocal.**
   Risk #3 punts between "snapshot/rollback UoW stub" and "simpler helper + defer." Pick one before implementation; otherwise the atomicity unit test (`inventory-service.test.ts` — rollback on dest write throw) cannot be authored deterministically. The codebase currently has no in-memory UoW at all, so "update memory-repos" is a new surface — scope it explicitly.

5. **`InventoryItemCreated` / `InventoryTransferred` / `InventoryExpired` event payload shape is unspecified.**
   Existing inventory event is a single `InventoryChanged` with `action` discriminator (`session-inventory.ts:56`). Plan adds 4 new event types without saying whether `InventoryChanged` is retired or kept alongside. SSE subscribers + test harness assertions key off type names. Decide: replace (and update transcript scenarios) or extend (and document the overlap).

6. **Stack-key merge: `magicItemId` + `longRestsRemaining` — confirm treatment of `undefined`.**
   Current merge key in `inventory.ts:59` is `name.toLowerCase()` only. Plan says "treat `undefined === undefined` as equal in merge key" (risk #2) but doesn't call out `magicItemId`. Both fields must use the same undefined-equality rule, or pre-existing stacks (no `magicItemId`, no `longRestsRemaining`) will silently split on next write.

## Missing Context

- Whether `SpellActionHandler.execute()` is invoked under a UoW (session-tabletop.ts path) or raw (session-actions.ts path). Determines #1's fix.
- Whether deferred event publishing (`deferred-publishing-event-repository.ts`) already handles post-commit fan-out automatically when events are appended inside `unitOfWork.run()`. If yes, "emit AFTER commit" is already the default and the plan's wording is misleading.

## Suggested Changes

1. **`InventoryService` methods accept an optional `repos?: RepositoryBundle` param.** When provided, operate on the txn repos (no nested UoW). When absent, start their own `unitOfWork.run()`. Pattern matches `character-service.ts` and keeps single-service-call / inside-UoW both valid.
2. **Move sweep into `takeSessionRest`** body, post-rest-update collection, pushing expired-stack removals into the same `pendingUpdates` array. Emit `InventoryExpired` via the existing events repo inside the UoW — deferred publisher handles post-commit fan-out.
3. **`transferItem` route**: follow `if (deps.unitOfWork)` guard pattern. In the no-UoW branch, document explicitly as "best-effort, non-atomic — test-only path." Add one SQLite integration test for true atomicity (already in test plan — good).
4. **Commit to**: ship a minimal `MemoryUnitOfWork` stub (pass-through `run(cb)` that invokes `cb` with the existing memory-repos bundle) with a single `rejectDestinationWrites` hook for the rollback test. Defer real snapshot/rollback. Document in `memory-repos.ts`.
5. **Event strategy**: keep `InventoryChanged` for CRUD (add/remove/equip/use-charge) as-is; add `InventoryItemCreated` (spell-cast provenance), `InventoryTransferred` (cross-character), `InventoryExpired` (sweep) as new discriminated types. Do NOT merge `InventoryItemUsed` into this — overlaps with `InventoryChanged action:"use"`. Pick one; recommend dropping `InventoryItemUsed` and extending `InventoryChanged` payload with optional `actionEconomyCost` field.
6. **Stack-merge**: add explicit test covering `(undefined magicItemId, undefined longRestsRemaining)` merging with legacy stacks.
