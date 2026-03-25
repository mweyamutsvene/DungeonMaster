# Plan: Phase 1 — Critical Combat Rules Fixes
## Round: 1
## Status: IN PROGRESS
## Affected Flows: CombatRules

## Objective
Fix 4 critical rule errors in the combat rules domain layer that cause incorrect D&D 5e 2024 outcomes. These are the highest-priority fixes because they produce wrong results in every combat encounter.

## Changes
### CombatRules

#### [File: domain/combat/attack-resolver.ts]
- [x] **Natural 1 auto-miss**: Add check that if the raw d20 roll is 1, the attack always misses regardless of total vs AC. D&D 2024 rule: "If the d20 roll for an attack is a 1, the attack misses regardless of any modifiers or the target's AC."
- [x] Ensure the miss result is returned with appropriate messaging (not just "miss" but indicates natural 1)

#### [File: domain/entities/combat/conditions.ts]
- [x] **Fix Restrained condition**: Change `autoFailStrDexSaves: true` to `autoFailStrDexSaves: false` and add `savingThrowDisadvantage: ['dexterity']` (disadvantage on DEX saves only). Per D&D 2024: "Disadvantage on Dexterity saving throws" — NOT auto-fail.
- [x] Verify Paralyzed, Stunned, Petrified, Unconscious correctly have `autoFailStrDexSaves: true` (these are the only ones that should)

#### [File: domain/combat/attack-resolver.ts or conditions effect consumers]
- [x] **Paralyzed/Unconscious auto-crit on melee within 5ft**: When a melee attack hits a Paralyzed or Unconscious creature and the attacker is within 5 feet, the hit is automatically a critical hit. D&D 2024: "Any attack that hits the creature is a Critical Hit if the attacker is within 5 feet."
- [x] This should apply AFTER the hit/miss check but BEFORE damage calculation
- [x] Add a helper function `isAutoCriticalHit(target, attackKind, attackerDistance)` in `attack-resolver.ts`

#### [File: domain/effects/damage-effect.ts or domain/rules/damage.ts]
- [x] **Temporary HP absorption**: When a creature with temporary HP takes damage, temp HP absorbs damage first. Remaining damage carries over to regular HP. D&D 2024: "If you have temporary hit points and receive damage, the temporary hit points are lost first."
- [x] Need a `tempHP` field on Creature or CreatureData
- [x] Need `takeDamage()` to check and reduce tempHP before regular HP
- [x] Temp HP does NOT stack — new temp HP replaces old if higher

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? — No, these are all isolated domain/combat fixes
- [x] Does the pending action state machine still have valid transitions? — Not affected
- [x] Is action economy preserved? — Not affected
- [x] Do both player AND AI paths handle the change? — Yes, attack resolution is shared
- [x] Are repo interfaces + memory-repos updated if entity shapes change? — tempHP added to CreatureData as optional field, backward compatible
- [x] Is `app.ts` registration updated if adding executors? — No new executors
- [x] Are D&D 5e 2024 rules correct (not 2014)? — Verified all 4 rules against 2024 PHB

## Risks
- **Temp HP field addition** may require DB migration or combatant state changes. Mitigate: store in combatant resources JSON rather than schema column.
- **Auto-crit on Paralyzed/Unconscious** changes damage output significantly. Verify Stunning Strike E2E scenario still passes.

## Test Plan
- [x] Unit test: natural 1 always misses even with +20 modifier (attack-resolver test)
- [x] Unit test: Restrained gives DEX save disadvantage, not auto-fail (conditions test)
- [x] Unit test: melee hit on Paralyzed creature within 5ft = critical (attack-resolver test)
- [x] Unit test: melee hit on Paralyzed creature beyond 5ft = NOT auto-crit (attack-resolver test)
- [x] Unit test: temp HP absorbs damage before real HP (creature test)
- [x] Unit test: temp HP doesn't stack, higher replaces (creature test)
- [ ] E2E scenario: natural-1-auto-miss.json
- [ ] E2E scenario: paralyzed-auto-crit.json
- [ ] Verify existing stunning-strike E2E scenario still passes
