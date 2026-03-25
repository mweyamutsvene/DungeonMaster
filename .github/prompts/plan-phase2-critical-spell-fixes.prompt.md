# Plan: Phase 2 — Critical Spell System Fixes
## Round: 1
## Status: IN_PROGRESS
## Affected Flows: SpellSystem, CombatOrchestration

## Objective
Fix 7 critical spell system bugs that cause incorrect D&D 5e 2024 spell behavior. Cantrips deal wrong damage after level 5, spells can't be upcast, AoE spells only hit one target, and several core spell mechanics are broken.

## Changes
### SpellSystem

#### [File: domain/entities/spells/prepared-spell-definition.ts]
- [ ] Add optional `castAtLevel?: number` field to `PreparedSpellDefinition` for upcasting support
- [x] Add cantrip scaling function: `getCantripDamageDice(baseCount, characterLevel)` returns scaled dice count at levels 5/11/17

#### [File: application/services/combat/tabletop/spell-delivery/spell-attack-delivery-handler.ts]
- [x] **Cantrip scaling**: When resolving spell attack damage, check if `spell.level === 0` and scale damage dice by character level. Formula: levels 1-4 = base, 5-10 = 2x, 11-16 = 3x, 17+ = 4x dice
- [x] Character level must come from the caster's combat resources or sheet

#### [File: application/services/combat/helpers/spell-slot-manager.ts]
- [ ] **Upcasting**: Modify `prepareSpellCast()` to accept an optional `castAtLevel` parameter
- [ ] Validate `castAtLevel >= spell.level` and `castAtLevel <= 9`
- [ ] Spend `spellSlot_${castAtLevel}` instead of `spellSlot_${spell.level}`
- [x] **Warlock Pact Magic**: Check `pactMagic` resource pool if no standard spell slot of the requested level exists. Pact Magic slots are all the same level (determined by warlock level)

#### [File: application/services/combat/tabletop/spell-action-handler.ts]
- [x] **Magic Missile damage**: The inline fallback path for Magic Missile must actually apply force damage. 3 darts at 1d4+1 each (1st level), +1 dart per level above 1st. Apply via DamageEffect to targets
- [ ] Support upcasting passthrough: forward `castAtLevel` from parsed action to delivery handlers

#### [File: application/services/combat/tabletop/spell-delivery/save-spell-delivery-handler.ts]
- [ ] **AoE instant spells**: For spells with area definitions (cone, sphere, etc.), resolve ALL creatures in the area — not just one `targetRef`. Needs grid-based area computation to find affected cells
- [ ] Add helper: `getCreaturesInArea(origin, shape, size, direction, combatants)` that returns all combatants within the AoE
- [ ] Each creature makes an independent saving throw
- [ ] Implement upcasting damage scaling (e.g., Burning Hands +1d6 per level above 1st)

#### [File: application/services/combat/tabletop/spell-delivery/healing-spell-delivery-handler.ts]  
- [ ] Implement upcasting: Cure Wounds +1d8 per level above 1st, etc.
- [ ] Accept `castAtLevel` and compute bonus healing dice

#### [File: application/services/combat/two-phase/spell-reaction-handler.ts]
- [x] **Counterspell mechanic fix**: Per D&D 2024 — Counterspell at level 3 auto-counters level ≤3 spells. For higher-level spells, the COUNTERSPELLER makes a spellcasting ability check (DC = 10 + spell level), NOT the original caster making a CON save
- [x] Support upcasting Counterspell: if cast at level N, auto-counters spells of level ≤N

#### [File: application/services/combat/combat-service.ts or action economy tracking]
- [x] **Bonus action spell restriction**: Track whether a leveled spell has been cast as a bonus action this turn. If so, only cantrips can be cast as an action. And vice versa: if a leveled spell was cast as an action, only a bonus-action cantrip is allowed
- [x] Add `bonusActionSpellCastThisTurn: boolean` and `actionSpellCastThisTurn: boolean` to resources or action economy

## Cross-Flow Risk Checklist
- [ ] Do changes in one flow break assumptions in another? — AoE targeting affects the action-handlers flow; verify AI spell handler works with multi-target
- [x] Does the pending action state machine still have valid transitions? — Spell delivery doesn't change pending action flow
- [x] Is action economy preserved? — Bonus action spell restriction adds a NEW economy constraint
- [ ] Do both player AND AI paths handle the change? — AI CastSpellHandler needs to pass castAtLevel; verify
- [ ] Are repo interfaces + memory-repos updated if entity shapes change? — castAtLevel is transient, not stored
- [x] Is `app.ts` registration updated if adding executors? — No new executors
- [x] Are D&D 5e 2024 rules correct (not 2014)? — Verified: Counterspell is ability check in 2024, cantrip scaling unchanged, upcasting unchanged

## Risks
- **AoE grid computation** is the most complex change — needs to work with existing pathfinding/grid system. May need a new spatial utility.
- **Upcasting propagation** touches many files — needs careful parameter threading from spell parsing → slot manager → delivery handler.
- **Bonus action spell restriction** could break AI spell casting if not threaded into AI context.

## Test Plan
- [x] Unit test: Fire Bolt at level 1 = 1d10, level 5 = 2d10, level 11 = 3d10, level 17 = 4d10
- [ ] Unit test: Cure Wounds upcast at level 2 = 2d8+mod, level 3 = 3d8+mod
- [ ] Unit test: Magic Missile at level 1 = 3 darts of 1d4+1, level 2 = 4 darts
- [ ] Unit test: Burning Hands hits all creatures in 15ft cone
- [ ] Unit test: Counterspell auto-counters same-level spell, higher needs ability check
- [ ] Unit test: Counterspell upcast at level 5 auto-counters level 5 spell
- [x] Unit test: Warlock can cast with pactMagic pool when standard slots empty
- [ ] Unit test: Bonus action Healing Word prevents leveled action spell same turn
- [ ] E2E scenario: cantrip-scaling.json
- [ ] E2E scenario: upcasting.json
- [ ] E2E scenario: aoe-burning-hands.json
- [ ] Verify existing concentration/counterspell E2E scenarios still pass
