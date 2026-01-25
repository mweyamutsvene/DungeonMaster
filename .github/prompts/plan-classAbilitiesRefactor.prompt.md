# Plan: Extract Class Abilities from TabletopCombatService

**STATUS: ✅ COMPLETED** (2024)

Unify class ability handling by routing TabletopCombatService bonus actions through the existing `AbilityRegistry` pattern. Fixes dead code paths (patient-defense, step-of-the-wind), reduces TabletopCombatService by ~180 lines, enables player and AI flows to share ability executors.

## Steps

1. ✅ **Extend `AbilityExecutionResult` type** — Added `pendingAction?`, `requiresPlayerInput?`, `rollType?`, `diceNeeded?`, `resourcesSpent?` fields in [ability-executor.ts](packages/game-server/src/domain/abilities/ability-executor.ts) to support tabletop's multi-step dice flow.

2. ✅ **Add ki points to combatant resources** — Updated `handleInitiativeRoll` in [tabletop-combat-service.ts](packages/game-server/src/application/services/combat/tabletop-combat-service.ts) to initialize ki points using `resourcePools: [{ name: "ki", current: X, max: X }]` format for compatibility with `hasResourceAvailable`.

3. ✅ **Inject AbilityRegistry into TabletopCombatService** — Added `abilityRegistry?: AbilityRegistry` to deps interface. Wired in [app.ts](packages/game-server/src/infrastructure/api/app.ts) using existing `AbilityRegistry` instance.

4. ✅ **Create unified `handleBonusAbility` method** — New private method (~140 lines) in TabletopCombatService that builds `AbilityExecutionContext` from actor/roster/combatant state and delegates to `abilityRegistry.execute()`. Handles result's `requiresPlayerInput` to return appropriate `ActionParseResult`.

5. ✅ **Adapt FlurryOfBlowsExecutor for tabletop** — Updated [flurry-of-blows-executor.ts](packages/game-server/src/application/services/combat/abilities/executors/flurry-of-blows-executor.ts) to split into `executeTabletopMode()` (returns pendingAction) and `executeAiMode()` (auto-rolls). Added `resourcesSpent: { kiPoints: 1 }`.

6. ✅ **Keep Flurry state machine in TabletopCombatService** — Flurry strike 1→2 branching remains in `handleAttackRoll`/`handleDamageRoll` as it manages pending action transitions. TabletopCombatService routes initial activation through registry.

7. ✅ **Route patient-defense and step-of-the-wind** — Updated `parseCombatAction` to call `handleBonusAbility` for all three monk abilities. Updated [patient-defense-executor.ts](packages/game-server/src/application/services/combat/abilities/executors/patient-defense-executor.ts) and [step-of-the-wind-executor.ts](packages/game-server/src/application/services/combat/abilities/executors/step-of-the-wind-executor.ts) with `resourcesSpent: { kiPoints: 1 }`.

8. ✅ **Keep handleFlurryOfBlows as fallback** — Retained as fallback when AbilityRegistry not available (e.g., some test configurations). Registry path is preferred when available.

9. ⏭️ **Add Fighter ability executors** — DEFERRED: Create `second-wind-executor.ts` and `action-surge-executor.ts` following monk pattern. Will implement when Fighter E2E scenarios are added.

10. ✅ **Run validation** — All 10 E2E scenarios pass (147 total steps), TypeScript compiles cleanly.

## Actual Changes Made

| File | Change |
|------|--------|
| `ability-executor.ts` | ✅ Added `pendingAction?`, `requiresPlayerInput?`, `rollType?`, `diceNeeded?`, `resourcesSpent?` |
| `tabletop-combat-service.ts` | ✅ Added `handleBonusAbility` (~140 lines), inject registry, kept fallback |
| `flurry-of-blows-executor.ts` | ✅ Split into tabletop/AI modes, added `resourcesSpent` |
| `patient-defense-executor.ts` | ✅ Added `resourcesSpent: { kiPoints: 1 }` |
| `step-of-the-wind-executor.ts` | ✅ Added `resourcesSpent: { kiPoints: 1 }` |
| `app.ts` | ✅ Wired `abilityRegistry` into TabletopCombatService |
| `second-wind-executor.ts` | ⏭️ DEFERRED to future enhancement |
| `action-surge-executor.ts` | ⏭️ DEFERRED to future enhancement |

## Actual Line Counts

| Location | Before | After |
|----------|--------|-------|
| `handleFlurryOfBlows` | 108 | 108 (kept as fallback) |
| Flurry branching in handlers | ~70 | ~70 (state machine retained) |
| New `handleBonusAbility` | 0 | ~140 |
| `flurry-of-blows-executor.ts` | ~60 | ~120 (dual mode) |
| **TabletopCombatService net** | **~1,680** | **~1,820** |

Note: Line count increased - added dual-mode capability without removing fallback for resilience.

## Completed Enhancements

1. ✅ **Ki point deduction** — Added `resourcesSpent: { kiPoints: 1 }` to executor results. TabletopCombatService uses `spendResourceFromPool` to persist deduction.

2. ⏭️ **Fighter resource tracking** — DEFERRED: Will add when Fighter E2E scenarios are implemented.

3. ⏭️ **Unified ability parsing** — DEFERRED: Current approach routes via `tryParseBonusActionText` with explicit ability ID mapping.

## Validation Results

```
═══════════════════════════════════════
📊 SUMMARY
═══════════════════════════════════════
  ✅ fighter-dodge: 12/12
  ✅ fighter-help: 15/15
  ✅ fighter-shove: 14/14
  ✅ happy-path: 9/9
  ✅ monk-flurry: 16/16
  ✅ multi-action: 30/30
  ✅ opportunity-attack: 11/11
  ✅ rogue-tactics: 17/17
  ✅ two-goblins: 15/15
  ✅ wizard-cast: 8/8
───────────────────────────────────────
  Total: 10 passed, 0 failed
═══════════════════════════════════════
```
