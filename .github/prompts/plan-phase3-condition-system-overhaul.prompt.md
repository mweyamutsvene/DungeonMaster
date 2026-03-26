# Plan: Phase 3 — Condition System Overhaul
## Round: 1
## Status: COMPLETE
## Affected Flows: CombatRules, CombatOrchestration

## Objective
Fix 5 condition mechanical effects that are either missing or incorrectly applied per D&D 5e 2024 rules. Conditions are referenced in nearly every combat interaction, so incorrect effects cascade through the entire system.

## Changes
### CombatRules

#### [File: domain/entities/combat/conditions.ts]
- [x] **Prone melee vs ranged distinction**: Currently marks Prone with BOTH `attackRollsHaveAdvantage` AND `attackRollsHaveDisadvantage` generically. D&D 2024: attacks within 5ft have advantage, attacks beyond 5ft have disadvantage. Need to change these to distance-conditional effects — either add `meleeAttackAdvantage`/`rangedAttackDisadvantage` or make the effect consumer distance-aware
- [x] **Poisoned**: Add `abilityCheckDisadvantage: true` — D&D 2024: "Disadvantage on ability checks AND attack rolls." Currently only has attack disadvantage
- [x] **Frightened**: Add `cannotMoveCloserToSource: true` flag. D&D 2024: "Can't willingly move closer to the source of its fear"
- [x] **Exhaustion levels**: Replace single boolean condition with a 1-6 level system. D&D 2024 exhaustion: each level gives −2 to d20 tests, speed reduced by 5×level feet. Level 6 = death. Add `exhaustionLevel` field to creature or condition
- [x] **Invisible**: Clarify the effect model — Invisible creature has advantage on attacks, AND attacks against it have disadvantage. Currently uses `attackRollsHaveAdvantage: true` with a confusing comment. Make the dual-direction clear with `selfAttackAdvantage` and `incomingAttackDisadvantage`

#### [File: domain/combat/attack-resolver.ts or condition effect consumers]
- [x] Prone distance-aware consumers: `combat-text-parser.ts` imports and calls `getProneAttackModifier()` for distance-based advantage/disadvantage
- [x] Invisible bidirectional handling: `combat-text-parser.ts` imports `hasSelfAttackAdvantage`, `hasIncomingAttackDisadvantage` — used for attacker/target roll modes
- [x] Poisoned ability check disadvantage: `grapple-action-handler.ts` imports `hasAbilityCheckDisadvantage` — applied to shove, grapple, escape

#### [File: application/services/combat/two-phase/move-reaction-handler.ts or movement rules]
- [x] **Frightened movement enforcement**: `move-reaction-handler.ts` imports `isFrightenedMovementBlocked` — checked during movement validation, throws ValidationError if moving closer to fear source
- [x] Need to track fear source on the Frightened condition (who applied it) — `source` field already exists on `ActiveCondition`, `createCondition` accepts `source` option

#### [File: domain/rules/ — new file or addition to conditions]
- [x] **Exhaustion level mechanics**: Create functions to apply exhaustion level effects:
  - `getExhaustionPenalty(level)` → d20 penalty (−2 per level)
  - `getExhaustionSpeedReduction(level)` → speed reduction (5×level feet)
  - `isExhaustionLethal(level)` → true at level 6
- [x] Exhaustion penalty integrated into attack rolls (`attack-action-handler.ts`, `attack-handlers.ts`, `ai-attack-resolver.ts`, `opportunity-attack-resolver.ts`), saving throws (`saving-throw-resolver.ts`), and ability checks (`grapple-action-handler.ts` — shove, grapple, escape)
- [x] Exhaustion speed reduction integrated into movement (`move-reaction-handler.ts` applies `getExhaustionSpeedReduction` to effective speed)

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? — No, all consumers wired correctly
- [x] Does the pending action state machine still have valid transitions? — Not affected
- [x] Is action economy preserved? — Not affected
- [x] Do both player AND AI paths handle the change? — Frightened movement uses move-reaction-handler (shared), exhaustion penalties in AI attack resolver
- [x] Are repo interfaces + memory-repos updated if entity shapes change? — Exhaustion level may need to be persisted in combatant state
- [x] Is `app.ts` registration updated if adding executors? — No new executors
- [x] Are D&D 5e 2024 rules correct? — Verified all conditions against 2024 PHB

## Risks
- **Prone distance check** requires attacker position context in attack resolution, which currently only has attack data. May need to thread position through.
- **Frightened source tracking** requires adding a `source` field to condition application, which touches condition creation throughout the codebase.
- **Exhaustion** is a significant new mechanic — keep the implementation minimal (penalty calculation + integration points) without over-engineering.

## Test Plan
- [x] Unit test: melee attack (5ft) vs Prone target has advantage
- [x] Unit test: ranged attack (30ft) vs Prone target has disadvantage
- [x] Unit test: Poisoned creature has disadvantage on ability checks AND attacks
- [x] Unit test: Frightened creature cannot move closer to fear source
- [x] Unit test: Exhaustion level 1 = −2 to d20 tests, 5ft speed reduction
- [x] Unit test: Exhaustion level 6 = death
- [x] Unit test: Invisible creature has advantage on attacks
- [x] Unit test: Attack against Invisible creature has disadvantage
- [x] E2E scenario: prone-melee-vs-ranged.json
- [x] E2E scenario: frightened-movement.json
