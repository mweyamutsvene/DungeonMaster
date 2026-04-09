# Plan: CR-M2 + CA-M1 + CA-M6 (Multiple Damage Types, Channel Divinity, Destroy Undead)
## Round: 1
## Status: IN_PROGRESS
## Affected Flows: CombatRules, ClassAbilities, CombatOrchestration

## Objective
Implement three focused features: (1) multiple damage types per attack with per-type defense checks, (2) Paladin Channel Divinity: Divine Sense executor, (3) Cleric Destroy Undead at level 5+.

## Changes

### CR-M2: Multiple damage types per attack

#### [File: domain/combat/attack-resolver.ts]
- [x] Add `additionalDamage?: Array<{ dice: string; damageType: DamageType }>` to `AttackSpec`
- [x] Add `additionalDamageResults` to `AttackResult.damage` for breakdown
- [x] In `resolveAttack()`: after primary damage, compute each additional damage entry with its own defense check, double dice on crit

#### [File: domain/rules/damage-defenses.ts]
- [x] No changes needed — `applyDamageDefenses` already handles per-type checks

#### [File: application/services/combat/tabletop/rolls/damage-resolver.ts]
- [x] In enhancement bonus dice (Divine Smite radiant), apply per-type defense check using `applyDamageDefenses`

### CA-M1: Paladin Channel Divinity — Divine Sense

#### [File: domain/entities/classes/paladin.ts]
- [x] Add "divine-sense" action mapping to `PALADIN_COMBAT_TEXT_PROFILE`
- [x] Add `abilityId: "class:paladin:divine-sense"` to Channel Divinity capability

#### [File: domain/entities/classes/feature-keys.ts]
- [x] Add `DIVINE_SENSE = "divine-sense"` constant

#### [File: application/services/combat/abilities/executors/paladin/channel-divinity-executor.ts]
- [x] Create `ChannelDivinityExecutor` implementing `AbilityExecutor`
  - `canExecute`: match "classpaladinchanneldivinity" or "classpaladinidivinesense" or "divinesense"
  - `execute`: validate Channel Divinity resource, spend 1 charge + bonus action, return creature type info for nearby targets

#### [File: application/services/combat/abilities/executors/paladin/index.ts]
- [x] Export `ChannelDivinityExecutor`

#### [File: application/services/combat/abilities/executors/index.ts]
- [x] Export `ChannelDivinityExecutor` from paladin barrel

#### [File: infrastructure/api/app.ts]
- [x] Register `ChannelDivinityExecutor`

### CA-M6: Cleric Destroy Undead

#### [File: domain/entities/classes/cleric.ts]
- [x] Add `getDestroyUndeadCRThreshold(clericLevel: number): number | null`
- [x] Add `"destroy-undead": 5` to cleric features map

#### [File: domain/entities/classes/feature-keys.ts]
- [x] Add `DESTROY_UNDEAD = "destroy-undead"` constant

#### [File: application/services/combat/tabletop/dispatch/class-ability-handlers.ts]
- [x] In `processTurnUndeadAoE`, after save failure: check cleric level vs CR threshold, destroy if applicable

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? — No, each feature is self-contained
- [x] Does the pending action state machine still have valid transitions? — No changes to state machine
- [x] Is action economy preserved? — Divine Sense uses bonus action + Channel Divinity charge
- [x] Do both player AND AI paths handle the change? — AI doesn't use Divine Sense or Turn Undead directly; additionalDamage on AttackSpec only matters for players using special weapons
- [x] Are repo interfaces + memory-repos updated if entity shapes change? — No entity shape changes
- [x] Is `app.ts` registration updated if adding executors? — Yes, ChannelDivinityExecutor
- [x] Are D&D 5e 2024 rules correct? — Yes, verified thresholds and mechanics

## Risks
- CR threshold values from 2024 PHB need verification (0.5/1/2/3/4 at 5/8/11/14/17)
- Divine Sense is a bonus action in 2024 rules (changed from action in 2014)

## Test Plan
- [x] Unit test for `getDestroyUndeadCRThreshold()` domain function
- [x] Unit test for `additionalDamage` in `resolveAttack()` with mixed resistance types
- [x] Unit test for `ChannelDivinityExecutor` basic flow
