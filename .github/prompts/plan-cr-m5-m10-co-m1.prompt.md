# Plan: CR-M5 + CR-M10 Distance Consolidation & CO-M1 Readied Action Triggers
## Round: 1
## Status: COMPLETE
## Affected Flows: CombatRules, CombatOrchestration

## Objective
Fix three audit items: (1) Replace Euclidean distance with D&D 5e grid distance (Chebyshev) in the canonical `calculateDistance`, (2) remove dead `domain/combat/movement.ts` and consolidate to a single distance function, (3) add `creature_attacks` readied trigger evaluation and readied spell concentration tracking.

## Changes

### CombatRules (CR-M5 + CR-M10)

#### [File: domain/rules/movement.ts]
- [x] Change `calculateDistance()` from Euclidean to Chebyshev distance: `max(|dx|, |dy|)` — matches D&D 5e 2024 standard grid rule (every diagonal = 5ft)
- [x] This automatically fixes `attemptMovement()`, `isWithinRange()`, `isWithinMeleeReach()`, `crossesThroughReach()`, `getPositionsInRadius()`

#### [File: domain/rules/movement.test.ts]
- [x] Update test expectations from Euclidean to Chebyshev results
- [x] Add explicit diagonal distance test (5,5 → 5ft not 7.07ft)

#### [File: domain/combat/movement.ts] — REMOVE (dead code)
- [x] Entire file is dead code. No application code imports from it or from `domain/combat/index.ts` for movement. Flanking/pathfinding/AI already use Chebyshev inline.

#### [File: domain/combat/index.ts]
- [x] Remove movement exports from barrel

#### [File: src/index.ts]
- [x] Verify no movement re-exports from domain/combat (already don't exist)

### CombatOrchestration (CO-M1)

#### [File: two-phase/attack-reaction-handler.ts]
- [x] After attack completes in `complete()`, scan all combatants for readied actions with `creature_attacks` trigger type
- [x] If found, fire the readied action (create reaction opportunity, resolve as OA attack)

#### [File: two-phase/move-reaction-handler.ts]
- [x] When readied action with `creature_attacks` trigger fires (during movement check), skip it (it's not a movement trigger) — already working, no change needed

#### [File: helpers/concentration-helper.ts]
- [x] Add `clearReadiedActionOnConcentrationBreak()` — when concentration breaks, check if readied action was a held spell and discard it

#### [File: helpers/resource-utils.ts]
- [x] Check if readied action structure already supports spell info (for concentration tracking)

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? — Chebyshev distance change affects all range checks consistently; this is correct behavior.
- [x] Does the pending action state machine still have valid transitions? Yes, readied_action reactions already resolved via OA resolver.
- [x] Is action economy preserved? Yes, readied actions use reactions.
- [x] Do both player AND AI paths handle the change? Chebyshev applies globally. AI already uses Chebyshev for targeting.
- [x] Are repo interfaces + memory-repos updated if entity shapes change? No entity shape changes.
- [x] Is `app.ts` registration updated if adding executors? No new executors.
- [x] Are D&D 5e 2024 rules correct? Chebyshev = standard grid rule. Readied triggers per 2024 PHB.

## Risks
- Chebyshev changes distance values everywhere — range checks that worked with Euclidean might behave differently (e.g., (3,4) was within 5ft Euclidean but Chebyshev gives max(3,4)=4 which is still within 5ft). Risk is low because grid positions should be on 5ft boundaries.
- The `creature_attacks` trigger fires after attack resolution — if there's a chain of readied actions, it could create complex reaction chains. Mitigated by: reactions can only fire once per round, and readied action is consumed on fire.

## Test Plan
- [x] Update movement.test.ts for Chebyshev expectations
- [x] E2E scenarios: run existing ready-action-attack.json to verify no regression
- [x] Verify typecheck passes
- [x] Verify test suite passes
