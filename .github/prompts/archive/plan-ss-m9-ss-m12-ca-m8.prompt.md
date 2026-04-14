# Plan: SS-M9 Spell Component Enforcement, SS-M12 Spell Catalog Expansion, CA-M8 Channel Divinity Naming Collision
## Round: 1
## Status: IN_PROGRESS
## Affected Flows: SpellSystem, ClassAbilities

## Objective
Three items: (1) Enforce verbal spell components (Stunned/Paralyzed/etc creatures with cannotSpeak can't cast V spells), (2) Add 10 missing spells to the catalog, (3) Rename Channel Divinity pool keys to avoid Paladin/Cleric multiclass collision.

## Changes

### SS-M9: Spell Component Enforcement
#### [File: application/services/combat/tabletop/spell-action-handler.ts]
- [x] Add verbal component validation after spell resolution, before slot spending
- [x] Use `readConditionNames()` + `getConditionEffects()` to check `cannotSpeak`
- [x] Return ValidationError if verbal spell blocked by condition

### SS-M12: Spell Catalog Expansion
#### [File: domain/entities/spells/catalog/level-1.ts]
- [x] Add Command, Faerie Fire, Sleep, Hunter's Mark, Hex

#### [File: domain/entities/spells/catalog/level-2.ts]
- [x] Add Aid, Darkness, Invisibility, Lesser Restoration, Web

#### [File: domain/entities/spells/catalog/level-1.ts + level-2.ts]
- [x] Register all new spells in their catalog arrays

### CA-M8: Channel Divinity Naming Collision
#### [File: domain/entities/classes/cleric.ts]
- [x] Rename pool name from "channelDivinity" to "channelDivinity:cleric"
- [x] Update restRefreshPolicy poolKey
- [x] Update capabilitiesForLevel resourceCost.pool

#### [File: domain/entities/classes/paladin.ts]
- [x] Rename pool name from "channelDivinity" to "channelDivinity:paladin"
- [x] Update restRefreshPolicy poolKey
- [x] Update capabilitiesForLevel resourceCost.pool

#### [File: application/services/combat/abilities/executors/paladin/channel-divinity-executor.ts]
- [x] Update "channelDivinity" references to "channelDivinity:paladin"

#### [File: application/services/combat/abilities/executors/cleric/turn-undead-executor.ts]
- [x] Update "channelDivinity" references to "channelDivinity:cleric"

#### [File: infrastructure/llm/ai-decision-maker.ts]
- [x] Update prompt text referencing pool names

#### [File: Tests]
- [x] Update class-resources.test.ts
- [x] Update rest.test.ts
- [x] Update turn-undead.json scenario

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? — AI decision maker prompt updated for pool names
- [x] Does the pending action state machine still have valid transitions? — No change
- [x] Is action economy preserved? — No change, spell component check is pre-cast validation only
- [x] Do both player AND AI paths handle the change? — Verbal check only in tabletop path; AI spells don't resolve mechanics anyway
- [x] Are repo interfaces + memory-repos updated if entity shapes change? — No shape changes
- [x] Is `app.ts` registration updated if adding executors? — No new executors
- [x] Are D&D 5e 2024 rules correct? — cannotSpeak from conditions.ts matches 2024 rules

## Test Plan
- [x] Typecheck passes
- [x] All existing tests pass with renamed pool keys
- [x] E2E combat scenarios pass
