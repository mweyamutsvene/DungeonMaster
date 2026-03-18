# Combat Bug Fixes — Session Transcript Analysis

**Status: ✅ COMPLETED**

## Summary

Three bugs were discovered by analyzing a real combat session transcript (Monk Kai Stormfist vs Orc Brute). All three were fixed using a test-first approach: failing E2E scenarios were created before any code changes.

---

## Bug 1: Movement Over-Spend

**Symptom**: Character moved 25ft + 7ft = 32ft on a 30ft movement budget.
**Root Cause**: `initiateMove()` in `two-phase-action-service.ts` validated against full `effectiveSpeed` (base speed ± dash/prone modifiers) instead of `movementRemaining`. The downstream `Math.max(0, ...)` clamping silently allowed overspending.
**Fix**: Cap `effectiveSpeed` by `movementRemaining` when the field is set on the combatant's resources.
**File**: `packages/game-server/src/application/services/combat/two-phase-action-service.ts`
**E2E Scenario**: `scenarios/core/movement-overspend.json` (9 steps)

## Bug 2: Flurry Text Greediness — Missing Extra Attacks

**Symptom**: "Attack with flurry of blows" produced only 2 attacks (Flurry strikes) instead of 4 (2 Extra Attack + 2 Flurry).
**Root Cause**: `tryMatchClassAction()` normalizes input by stripping non-alphanumeric chars → `"attackwithflurryofblows"`. The regex `/flurry|flurryofblows/` greedily matched the "flurry" substring, routing the ENTIRE command to `handleBonusAbility()` and skipping the Attack action.
**Fix**: Changed pattern to `/(?<!attack.*?)flurry|^flurryofblows$/` — negative lookbehind prevents matching when preceded by "attack". When user types "attack with flurry of blows", it now falls through to LLM which correctly parses it as an attack action first.
**File**: `packages/game-server/src/domain/entities/classes/monk.ts`
**E2E Scenario**: `scenarios/monk/flurry-extra-attack.json` (17 steps)

## Bug 3: Ki Not Deducted for Flurry in Tabletop Mode

**Symptom**: After Flurry of Blows, ki showed 4/5 → should have been 3/5 (was actually never deducted).
**Root Cause**: `handleBonusAbility()` in `action-dispatcher.ts` has two branches: (1) `requiresPlayerInput` (tabletop mode — Flurry takes this path), (2) "completed immediately" (Patient Defense, Step of Wind). Ki spending via `spendResourceFromPool()` only existed in branch 2.
**Fix**: Added `spendResourceFromPool()` calls for ki and secondWind resources in the `requiresPlayerInput` branch, immediately after `useBonusAction()`.
**File**: `packages/game-server/src/application/services/combat/tabletop/action-dispatcher.ts`
**E2E Scenario**: `scenarios/monk/flurry-ki-spending.json` (15 steps)

---

## Test Results After Fixes

- **E2E**: 71 scenarios passed, 0 failed (was 68 before — 3 new scenarios added)
- **Unit/Integration**: 410 passed, 36 skipped, 0 failures
- **TypeScript**: Clean compile

## Files Modified

| File | Change |
|------|--------|
| `two-phase-action-service.ts` | Cap `effectiveSpeed` by `movementRemaining` |
| `action-dispatcher.ts` | Spend ki/resources in `requiresPlayerInput` branch |
| `monk.ts` | Flurry regex negative lookbehind |
| `scenarios/monk/flurry.json` | Added ki assertion step (14→17 steps) |

## Files Created

| File | Purpose |
|------|---------|
| `scenarios/core/movement-overspend.json` | Movement budget enforcement |
| `scenarios/monk/flurry-extra-attack.json` | Full 4-attack monk chain + ki assertion |
| `scenarios/monk/flurry-ki-spending.json` | Flurry ki deduction verification |

## Lessons / Architecture Notes

1. **Two-branch trap in `handleBonusAbility()`**: The `requiresPlayerInput` vs "completed immediately" split means ANY resource spending must be duplicated in both branches. Consider refactoring to a single resource-spending step before the branch.
2. **Text normalization + greedy regex**: `tryMatchClassAction()` strips all non-alphanumeric chars before matching. Patterns need careful anchoring (lookbehinds, `^`/`$`) to avoid false positives on compound commands.
3. **Movement validation layering**: `initiateMove()` is the gatekeeper for movement distance. `handleMoveAction()` decrements remaining after success. The clamping `Math.max(0, ...)` should probably throw instead of silently clamping.
