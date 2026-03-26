# Plan: Phase 2 — Critical Spell System Fixes
## Round: 1
## Status: COMPLETE
## Affected Flows: SpellSystem, CombatOrchestration

## Objective
Fix 7 critical spell system bugs that cause incorrect D&D 5e 2024 spell behavior. Cantrips deal wrong damage after level 5, spells can't be upcast, AoE spells only hit one target, and several core spell mechanics are broken.

## Changes
### SpellSystem

#### [File: domain/entities/spells/prepared-spell-definition.ts]
- [x] ~~Add optional `castAtLevel?: number` field~~ — UNNECESSARY: `castAtLevel` passed as runtime parameter through call chain, not on the type definition (better design)
- [x] Add cantrip scaling function: `getCantripDamageDice(baseCount, characterLevel)` returns scaled dice count at levels 5/11/17

#### [File: application/services/combat/tabletop/spell-delivery/spell-attack-delivery-handler.ts]
- [x] **Cantrip scaling**: When resolving spell attack damage, check if `spell.level === 0` and scale damage dice by character level. Formula: levels 1-4 = base, 5-10 = 2x, 11-16 = 3x, 17+ = 4x dice
- [x] Character level must come from the caster's combat resources or sheet

#### [File: application/services/combat/helpers/spell-slot-manager.ts]
- [x] **Upcasting**: `prepareSpellCast()` accepts optional `castAtLevel` parameter
- [x] Validates `castAtLevel >= spell.level` and `castAtLevel <= 9` in spell-action-handler.ts
- [x] Spends `spellSlot_${castAtLevel}` instead of `spellSlot_${spell.level}`
- [x] **Warlock Pact Magic**: Check `pactMagic` resource pool if no standard spell slot of the requested level exists. Pact Magic slots are all the same level (determined by warlock level)

#### [File: application/services/combat/tabletop/spell-action-handler.ts]
- [x] **Magic Missile damage**: The inline fallback path for Magic Missile must actually apply force damage. 3 darts at 1d4+1 each (1st level), +1 dart per level above 1st. Apply via DamageEffect to targets
- [x] Upcasting passthrough: `castAtLevel: effectiveCastLevel` forwarded to all delivery handlers

#### [File: application/services/combat/tabletop/spell-delivery/save-spell-delivery-handler.ts]
- [x] **AoE instant spells**: `save-spell-delivery-handler.ts` imports `getCreaturesInArea` and dispatches to `handleAoE()` when area is set
- [x] `getCreaturesInArea()` in `domain/rules/area-of-effect.ts` — cone/sphere/cube/line/cylinder geometry with 34 unit tests
- [x] Each creature makes an independent saving throw in `handleAoE()` path
- [x] Upcasting damage scaling via `getUpcastBonusDice()` — adds bonus dice per level above base

#### [File: application/services/combat/tabletop/spell-delivery/healing-spell-delivery-handler.ts]  
- [x] Upcasting implemented: `healing-spell-delivery-handler.ts` calls `getUpcastBonusDice()` and adds bonus heal dice
- [x] Accepts `castAtLevel` and computes bonus healing dice

#### [File: application/services/combat/two-phase/spell-reaction-handler.ts]
- [x] **Counterspell mechanic fix**: Per D&D 2024 — Counterspell at level 3 auto-counters level ≤3 spells. For higher-level spells, the COUNTERSPELLER makes a spellcasting ability check (DC = 10 + spell level), NOT the original caster making a CON save
- [x] Support upcasting Counterspell: if cast at level N, auto-counters spells of level ≤N

#### [File: application/services/combat/combat-service.ts or action economy tracking]
- [x] **Bonus action spell restriction**: Track whether a leveled spell has been cast as a bonus action this turn. If so, only cantrips can be cast as an action. And vice versa: if a leveled spell was cast as an action, only a bonus-action cantrip is allowed
- [x] Add `bonusActionSpellCastThisTurn: boolean` and `actionSpellCastThisTurn: boolean` to resources or action economy

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? — AoE targeting uses shared `save-spell-delivery-handler` for both paths
- [x] Does the pending action state machine still have valid transitions? — Spell delivery doesn't change pending action flow
- [x] Is action economy preserved? — Bonus action spell restriction adds a NEW economy constraint
- [x] Do both player AND AI paths handle the change? — `castAtLevel` flows through unified pipeline
- [x] Are repo interfaces + memory-repos updated if entity shapes change? — castAtLevel is transient, not stored
- [x] Is `app.ts` registration updated if adding executors? — No new executors
- [x] Are D&D 5e 2024 rules correct (not 2014)? — Verified: Counterspell is ability check in 2024, cantrip scaling unchanged, upcasting unchanged

## Risks
- **AoE grid computation** is the most complex change — needs to work with existing pathfinding/grid system. May need a new spatial utility.
- **Upcasting propagation** touches many files — needs careful parameter threading from spell parsing → slot manager → delivery handler.
- **Bonus action spell restriction** could break AI spell casting if not threaded into AI context.

## Test Plan
- [x] Unit test: Fire Bolt at level 1 = 1d10, level 5 = 2d10, level 11 = 3d10, level 17 = 4d10
- [x] Unit test: Cure Wounds upcast — "upcasting (castAtLevel)" test suite in spell-action-handler.test.ts
- [x] Unit test: Magic Missile handling in spell-action-handler.ts with upcasting
- [x] Unit test: Burning Hands AoE — aoe-burning-hands.json E2E + 21 integration tests
- [x] Unit test: Counterspell auto-counters same-level spell, higher needs ability check
- [x] Unit test: Counterspell upcast at level 5 auto-counters level 5 spell
- [x] Unit test: Warlock can cast with pactMagic pool when standard slots empty
- [x] Unit test: Bonus action Healing Word prevents leveled action spell same turn
- [x] E2E scenario: cantrip-scaling.json
- [x] E2E scenario: upcasting.json
- [x] E2E scenario: aoe-burning-hands.json — 3 goblins in cone, independent DEX saves
- [x] Verify existing concentration/counterspell E2E scenarios still pass
