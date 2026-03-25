# Plan: Phase 3 — Condition System Overhaul
## Round: 1
## Status: IN PROGRESS
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
- [ ] Update attack resolution to check attacker distance when applying Prone condition effects — advantage if within 5ft, disadvantage if farther (NOTE: `getProneAttackModifier()` helper created, consumers in CombatOrchestration flow need to call it)
- [ ] Update attack resolution to correctly handle Invisible — attacker gets advantage on their attacks, targets get disadvantage when attacking the invisible creature (NOTE: `hasSelfAttackAdvantage()` and `hasIncomingAttackDisadvantage()` helpers created, consumers need to call them)
- [ ] Ensure Poisoned disadvantage is applied to ability checks (grapple, escape, skill checks) in addition to attacks (NOTE: `hasAbilityCheckDisadvantage()` helper created, consumers need to call it)

#### [File: application/services/combat/two-phase/move-reaction-handler.ts or movement rules]
- [ ] **Frightened movement enforcement**: When a Frightened creature attempts to move, validate the destination is NOT closer to the fear source than the current position. Block or warn if moving closer (NOTE: `isFrightenedMovementBlocked()` and `getFrightenedSourceId()` helpers created, consumers in CombatOrchestration flow need to call them)
- [x] Need to track fear source on the Frightened condition (who applied it) — `source` field already exists on `ActiveCondition`, `createCondition` accepts `source` option

#### [File: domain/rules/ — new file or addition to conditions]
- [x] **Exhaustion level mechanics**: Create functions to apply exhaustion level effects:
  - `getExhaustionPenalty(level)` → d20 penalty (−2 per level)
  - `getExhaustionSpeedReduction(level)` → speed reduction (5×level feet)
  - `isExhaustionLethal(level)` → true at level 6
- [ ] Integrate exhaustion penalty into ability checks, attack rolls, saving throws (NOTE: `getExhaustionD20Penalty()` helper created, consumers in CombatOrchestration flow need to apply it)
- [ ] Integrate speed reduction into movement calculation (NOTE: `getExhaustionSpeedReduction()` / `getExhaustionLevel()` helpers created, movement consumers need to apply it)

## Cross-Flow Risk Checklist
- [ ] Do changes in one flow break assumptions in another? — Prone distance check affects attack-resolver consumers in CombatOrchestration
- [x] Does the pending action state machine still have valid transitions? — Not affected
- [x] Is action economy preserved? — Not affected
- [ ] Do both player AND AI paths handle the change? — Frightened movement block needs to work for both player movement and AI movement
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
- [ ] E2E scenario: prone-melee-vs-ranged.json
- [ ] E2E scenario: frightened-movement.json
