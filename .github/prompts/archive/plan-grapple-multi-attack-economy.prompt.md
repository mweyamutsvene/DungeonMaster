# Plan: Grapple + Multi-Attack Economy

## Round: 1
## Status: DONE
## Affected Flows: CombatRules, CombatOrchestration

## Objective

D&D 5e 2024: Grapple and Shove replace ONE attack within a multi-attack action (Unarmed Strike). Currently `action-service.ts` calls `spendAction()` which marks the full action as spent. A Fighter with Extra Attack (level 5+) should be able to grapple/shove + attack in the same turn.

The multi-attack infrastructure already exists (`useAttack()`, `canMakeAttack()`, `attacksUsedThisTurn`/`attacksAllowedThisTurn` in resource-utils.ts). This was previously marked as blocked but the blocker has been lifted.

## Changes

### CombatOrchestration Flow

#### [File: application/services/combat/action-service.ts]
- [x] Add imports: `useAttack`, `canMakeAttack`, `setAttacksAllowed`, `getAttacksAllowedThisTurn` from resource-utils
- [x] Add import: `ClassFeatureResolver` from domain
- [x] **grapple() method**: 
  - Pass `skipActionCheck: true` to `resolveActiveActorOrThrow()` (skip old `hasSpentAction()`)
  - Move `getCombatStats(input.actor)` earlier (before resource setup)
  - Set up `attacksAllowedThisTurn` from `ClassFeatureResolver.getAttacksPerAction()` if > 1
  - Check `canMakeAttack()` — throw if false
  - Replace `spendAction(actorState.resources)` with `useAttack(currentResources)`
- [x] **shove() method**: Same pattern as grapple
- [x] **escapeGrapple()**: No changes (correctly uses full action per D&D 5e 2024)

#### [File: application/services/combat/tabletop/grapple-handlers.ts]
- [x] **handleGrappleAction()**: After resolving, check if actor still has attacks remaining → set `actionComplete` dynamically (false if attacks remain, true if action fully spent)
- [x] **handleShoveAction()**: Same pattern
- [x] Add imports: `canMakeAttack` from resource-utils, read updated combatant state after action-service call

#### [File: application/services/combat/ai/ai-action-executor.ts]
- [x] No changes needed — delegates to action-service.ts which handles the economy correctly. But the AI will now get to make another attack after grapple/shove if it has Extra Attack. The existing AI turn loop already handles this (checks actionSpent before deciding next action).

### Test Updates

#### [File: scripts/test-harness/scenarios/core/grappled-effects.json]
- [x] Update `actionComplete: true` → `actionComplete: false` for the grapple step (Fighter L5 = 2 attacks/action)
- [x] Add an attack step after grapple (same turn) to demonstrate multi-attack works
- [x] Remove the `endTurn` between grapple and attack (or move after the attack)

#### [New File: scripts/test-harness/scenarios/fighter/grapple-extra-attack.json]
- [x] New scenario: Fighter L5 grapples then attacks in same turn (core multi-attack test)
- [x] Validates: grapple uses 1 attack, attack uses 2nd attack, then action is spent

#### [New File: scripts/test-harness/scenarios/core/grapple-single-attack.json]
- [x] New scenario: Fighter L3 (no Extra Attack) grapples — action fully spent
- [x] Validates backward compatibility: grapple uses full action for non-Extra-Attack characters

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? — No, action-service.ts is the single source for grapple/shove action economy
- [x] Does the pending action state machine still have valid transitions? — Yes, grapple/shove don't use pending actions (resolved immediately)
- [x] Is action economy preserved (1 action, 1 bonus, 1 reaction, 1 movement)? — Yes, `useAttack()` properly counts attacks within the action
- [x] Do both player AND AI paths handle the change? — Yes, both delegate to action-service.ts
- [x] Are repo interfaces + memory-repos updated if entity shapes change? — No entity shape changes
- [x] Is `app.ts` registration updated if adding executors? — Not applicable
- [x] Are D&D 5e 2024 rules correct (not 2014)? — Yes, Unarmed Strike attack per 2024 rules

## Risks
- Existing E2E scenario `grappled-effects.json` asserts `actionComplete: true` for Fighter L5 grapple → must update
- AI decision making may not optimally use the new multi-attack + grapple economy but this is enhancement not a bug

## Test Plan
- [x] Unit tests: resource-utils.ts multi-attack functions already tested
- [x] E2E: fighter/grapple-extra-attack.json (grapple + attack same turn)
- [x] E2E: core/grapple-single-attack.json (no Extra Attack → full action consumed)
- [x] Existing grapple E2E scenarios pass (with updated expectations)
- [x] Typecheck passes
- [x] All tests pass (153/153 E2E, 596 unit tests)
