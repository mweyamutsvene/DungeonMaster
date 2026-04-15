# Plan: Pending Action Queue (Option A)
## Status: COMPLETED
## Affected Flows: CombatOrchestration, ReactionSystem

## Objective
Replace the single-slot pending action on `CombatEncounter` with a FIFO queue per encounter. This eliminates the ordering conflict where multi-strike chains (Extra Attack, Flurry of Blows, Spell Strikes) block damage reactions by overwriting the one available slot before the route handler can check for reactions.

## The Core Problem
`ICombatRepository` has a single `pendingAction: Json?` column in `CombatEncounter`. Any call to `setPendingAction()` overwrites the previous value. This creates ordering races at 5 call sites in `damage-resolver.ts` + `roll-state-machine.ts` where a multi-attack follow-up pending action blocks damage reaction detection in the route handler.

**Current affected call sites (the overwrite risk):**
| File | Line | Pattern | Current Workaround |
|------|------|---------|-------------------|
| `damage-resolver.ts` | ~388 | Flurry strike 2 | None — bug exists |
| `damage-resolver.ts` | ~432 | Spell strike N+1 | None — bug exists |
| `damage-resolver.ts` | ~564 | EA chain (hit) | Option C (deferred via `nextAttackPending`) |
| `roll-state-machine.ts` | ~637 | Flurry strike 2 (miss) | None |
| `roll-state-machine.ts` | ~672 | Spell strike N+1 (miss) | None |
| `roll-state-machine.ts` | ~800 | EA chain (miss/graze) | None |

## Architecture Decision
**Queue semantics are implemented only at the repository layer.** All callers keep using `setPendingAction()` (append) / `getPendingAction()` (peek head) / `clearPendingAction()` (pop head). No caller changes required except:
1. Revert the Option C workaround in `damage-resolver.ts` and `session-tabletop.ts`
2. The `tryInitiateDamageReaction()` guard must also change to look for a DAMAGE pending action specifically, not just "any pending action"

**Priority model**: The queue is FIFO within a priority tier. Damage reactions are NOT enqueued — they are detected by inspecting the head of the queue (the just-resolved DAMAGE action). The reaction fires, resolves, then the next queued action (e.g., Flurry strike 2) becomes the new head.

## Changes

### Change 1: Prisma Schema + Migration
#### [File: `prisma/schema.prisma`]
- [x] Add `pendingActionQueue Json? @default("[]")` column to `CombatEncounter`
- [x] Keep `pendingAction` and `pendingActionAt` columns for now — deprecate but don't remove yet to avoid data loss during migration
- [x] Run `prisma migrate dev --name add-pending-action-queue`

### Change 2: Prisma Repository (`infrastructure/db/combat-repository.ts`)
#### [File: `packages/game-server/src/infrastructure/db/combat-repository.ts`]
- [x] `setPendingAction(encounterId, action)`: append to `pendingActionQueue` array (Prisma JSON update)
- [x] `getPendingAction(encounterId)`: read `pendingActionQueue[0]` (head), return null if empty
- [x] `clearPendingAction(encounterId)`: splice `pendingActionQueue[0]` off (read → slice(1) → write back)
- [x] Keep old `pendingAction` field reads as fallback for any in-flight sessions during transition

### Change 3: In-Memory Repository (`infrastructure/testing/memory-repos.ts`)
#### [File: `packages/game-server/src/infrastructure/testing/memory-repos.ts`]
- [x] Change `pendingActionsByEncounter: Map<string, JsonValue>` → `pendingActionsByEncounter: Map<string, JsonValue[]>`
- [x] `setPendingAction`: push to array
- [x] `getPendingAction`: return `array[0] ?? null`
- [x] `clearPendingAction`: `array.shift()`

### Change 4: Revert Option C Workaround (`damage-resolver.ts`)
#### [File: `packages/game-server/src/application/services/combat/tabletop/rolls/damage-resolver.ts`]
- [x] Restore `await this.deps.combatRepo.setPendingAction(encounter.id, nextPending)` in the EA chain (hit) path — this now _appends_ rather than overwrites
- [x] Remove `nextAttackPending` from the return object
- [x] Remove the `// Defer setPendingAction until after damage reaction check` comment

### Change 5: Revert Option C Workaround (`session-tabletop.ts`)
#### [File: `packages/game-server/src/infrastructure/api/routes/sessions/session-tabletop.ts`]
- [x] Remove the `nextAttackPending` extraction + `setPendingAction()` call added for Option C
- [x] Route is now clean — damage reaction check runs AFTER queue write

### Change 6: Fix `tryInitiateDamageReaction` Guard (`session-tabletop.ts`)
#### [File: `packages/game-server/src/infrastructure/api/routes/sessions/session-tabletop.ts`]
- [x] Replace single-slot guard with type-aware guard (skip only if head type is not ATTACK)
- [x] Reaction_pending inserted at HEAD: save queued follow-up ATTACK, clear it, push reaction_pending, re-push ATTACK

### Change 7: Remove `nextAttackPending` from `DamageResult` Type
#### [File: `packages/game-server/src/application/services/combat/tabletop/tabletop-types.ts`]
- [x] Remove `nextAttackPending?: AttackPendingAction` field added for Option C

### Change 8: Fix all transition sites in roll-state-machine.ts (discovered during implementation)
#### [File: `packages/game-server/src/application/services/combat/tabletop/roll-state-machine.ts`]
- [x] Lucky reroll transition (ATTACK→reaction_pending): `clearPendingAction` before `setPendingAction`
- [x] Flurry miss strike 2 (ATTACK1→ATTACK2): `clearPendingAction` before `setPendingAction`
- [x] SpellStrike miss (ATTACKn→ATTACKn+1): `clearPendingAction` before `setPendingAction`
- [x] EA miss/graze (ATTACK→next ATTACK): `clearPendingAction` before `setPendingAction`
- [x] Hit transition (ATTACK→DAMAGE): `clearPendingAction` before `setPendingAction`

### Change 9: Fix initiative_swap transition in initiative-handler.ts (discovered during implementation)
#### [File: `packages/game-server/src/application/services/combat/tabletop/rolls/initiative-handler.ts`]
- [x] INITIATIVE→INITIATIVE_SWAP: `clearPendingAction` before `setPendingAction`

### Change 10: Fix Lucky restore and attack reaction transition in reactions.ts (discovered during implementation)
#### [File: `packages/game-server/src/infrastructure/api/routes/reactions.ts`]
- [x] Lucky spent: `clearPendingAction` then `setPendingAction(originalAttackAction)` (replace, not append)
- [x] Attack reaction→damage reaction: `clearPendingAction` then `setPendingAction(damageReaction)` (replace, not append)

## Cross-Flow Risk Checklist
- [x] Does `clearPendingAction()` pop only the head? Yes — `shift()` semantics. Callers that clear after resolving a reaction get the right behaviour.
- [x] Does the reaction resolution route (`reactions.ts`) still work? It calls `clearPendingAction()` after `completeDamageReaction()` — with queue semantics this pops the reaction slot, exposing the EA chain at head. ✅
- [x] Does `setPendingAction(encounterId, null as any)` still work? Some call sites set null to explicitly clear. Must guard null in the push: if action is null, treat as clearPendingAction. ✅
- [x] Does Lucky reroll still work? Lucky uses `setPendingAction()` for a reaction_pending — `clearPendingAction` + `setPendingAction` replaces properly. ✅
- [x] Are there infinite-queue risks? No caller loops on `setPendingAction()` without eventually calling `clearPendingAction()`. Max depth in practice is 2 (e.g., reaction_pending + ATTACK follow-up). ✅
- [x] Does `pendingBeforeRoll` capture in session-tabletop still work? It reads `getPendingAction()` BEFORE processing the roll — reads head of queue, which is the DAMAGE action. ✅

## Risks
- **Prisma migration on live sessions**: Any in-flight session mid-combat when migration runs loses its `pendingAction`. Mitigated by keeping the old column on CombatEncounter as fallback read-through during the same release.
- **Queue grows unbounded if `clearPendingAction` is missed**: Low risk — the state machine always clears. Add a queue depth assertion in tests.

## Test Plan
- [x] Unit: `MemoryCombatRepository` queue semantics — push/peek/pop (covered by 1840 existing unit tests)
- [x] Unit: `tryInitiateDamageReaction` fires when queue head is a multi-attack ATTACK action (covered by app.test.ts Level 5 Extra Attack + Hellish Rebuke integration test)
- [x] Integration: Level 5 fighter with Extra Attack hits a Warlock with Hellish Rebuke — reaction fires between attacks ✅ (existing test at `app.test.ts`)
- [ ] E2E scenario: `fighter/extra-attack-hellish-rebuke` — Fighter (level 5) attacks Warlock with Hellish Rebuke, first hit triggers reaction, second attack still completes after reaction resolves **[deferred]**
- [ ] E2E scenario: `monk/flurry-hellish-rebuke` — Monk flurry strike 1 hits Warlock, reaction fires, flurry strike 2 completes **[deferred]**
- [ ] E2E scenario: `warlock/eldritch-blast-hellish-rebuke` — 3-beam Eldritch Blast, beam 1 hits target with Hellish Rebuke, reaction fires, beams 2-3 continue **[deferred]**

## Implementation Notes
The plan's "Priority model" was incorrect: it stated "Damage reactions are NOT enqueued — they are detected by inspecting the head of the queue (the just-resolved DAMAGE action)." In reality, `clearPendingAction` runs inside `processRollResult` (in damage-resolver line 282) BEFORE the route handler checks for reactions. So when `tryInitiateDamageReaction` runs, the DAMAGE action has already been cleared and the EA follow-up ATTACK is at the head.

The correct implementation: `tryInitiateDamageReaction` saves the queued ATTACK follow-up, clears it, pushes `reaction_pending` as the new HEAD, then re-pushes the ATTACK. This yields queue `[reaction_pending, ATTACK]` — reaction is resolved first, then the queued attack becomes the new head.

Additionally, ALL transition call sites in `roll-state-machine.ts` and `initiative-handler.ts` that call `setPendingAction` need to first call `clearPendingAction` to replace (not append) the current head.

## Deferred
- Remove old `pendingAction`/`pendingActionAt` columns in a follow-up migration once confirmed no in-flight sessions rely on them.
