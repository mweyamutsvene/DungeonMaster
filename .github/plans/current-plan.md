# Plan: Barbarian Phase 8.1 — Complete Barbarian Class Features

## Round: 2
## Status: APPROVED
## Affected Flows: ClassAbilities, CombatRules, CombatOrchestration, EntityManagement

## Objective
Fill the 6 remaining Barbarian class feature gaps. Two features (Rage Resistance, Extra Attack) are already implemented and only need E2E verification. Four features need new code.

## Pre-Implementation Findings

| Feature | Status | Work Needed |
|---------|--------|-------------|
| Rage Damage Resistance | **ALREADY DONE** | E2E scenario only |
| Extra Attack (Lv 5) | **ALREADY DONE** | E2E scenario only |
| Unarmored Defense | **NOT DONE** | Domain helper + mock generator template |
| Danger Sense (Lv 2) | **NOT DONE** | Domain helper + ActiveEffect at combat init |
| Rage End Mechanics | **NOT DONE** | Turn tracking flags + advanceTurn hook + KO handler |
| Feral Instinct (Lv 7) | **NOT DONE** | Initiative advantage + anti-surprise |

## Changes

### ClassAbilities

#### [File: packages/game-server/src/domain/entities/classes/barbarian.ts]
- [ ] Add `barbarianUnarmoredDefenseAC(dexMod: number, conMod: number): number` — returns `10 + dexMod + conMod`
- [ ] Add `hasDangerSense(level: number): boolean` — returns `level >= 2`
- [ ] Add `hasFeralInstinct(level: number): boolean` — returns `level >= 7`
- [ ] Add `shouldRageEnd(attacked: boolean, tookDamage: boolean, isUnconscious: boolean): boolean` — returns `true` if rage should end (didn't attack AND didn't take damage, OR is unconscious)
- [ ] Add `capabilitiesForLevel(level: number): string[]` to the `Barbarian` ClassDefinition — list Unarmored Defense, Rage, Danger Sense (2+), Reckless Attack (2+), Extra Attack (5+), Feral Instinct (7+)

#### [File: packages/game-server/src/domain/entities/classes/class-feature-resolver.ts]
- [ ] Add `static hasDangerSense(sheet: any, className: string, level: number): boolean` — delegates to `barbarian.hasDangerSense(level)` after checking `isBarbarian()`
- [ ] Add `static hasFeralInstinct(sheet: any, className: string, level: number): boolean` — delegates to `barbarian.hasFeralInstinct(level)` after checking `isBarbarian()`

No new executors needed. No changes to `app.ts` registration.

### CombatRules

No domain rules file changes needed:
- `damage-defenses.ts` — Rage resistance already works via ActiveEffects
- `attack-resolver.ts` — AC is read from sheet, no runtime override needed

### CombatOrchestration

#### [File: packages/game-server/src/application/services/combat/tabletop/roll-state-machine.ts]

**Feral Instinct — Server Auto-Rolled Initiative:**
- [ ] Expand `computeInitiativeRollMode()` signature to accept optional `classInfo?: { className: string; level: number }`
- [ ] If `classInfo` is Barbarian level 7+ (`hasFeralInstinct`), increment `adv++`
- [ ] If creature would be surprised AND has Feral Instinct AND NOT incapacitated, decrement `disadv--` to negate surprise disadvantage
- [ ] Update 3 auto-roll call sites (multi-PC L574, monster L644, NPC L703) to pass `classInfo` when available from the character sheet

**Danger Sense — DEX Save Advantage at Combat Init:**
- [ ] In `handleInitiativeRoll()`, after building combatant resources for each party member: if Barbarian level 2+, add a permanent ActiveEffect for DEX saving throw advantage with `source: "Danger Sense"`. The `SavingThrowResolver` already checks `hasAdvantageFromEffects(effects, 'saving_throws', saveAbility)` — no additional resolver changes needed for the base case.

**Rage End Mechanics — Attack Tracking (handleAttackRoll):**
- [ ] In `handleAttackRoll()` (~L1025), after the attack roll is resolved (regardless of hit/miss), if the attacker has `raging: true` in resources, set `rageAttackedThisTurn: true` on the attacker's resources. D&D 5e 2024: "attacked a hostile creature" means made an attack roll, not necessarily hit.

**Rage End Mechanics — Damage Taken Tracking (handleDamageRoll):**
- [ ] In `handleDamageRoll()`, when damage is applied to a target who has `raging: true`, set `rageDamageTakenThisTurn: true` on the target's resources.

#### [File: packages/game-server/src/application/services/combat/tabletop-combat-service.ts]

**Feral Instinct — Player-Rolled Initiative:**
- [ ] Expand `computeInitiativeModifiers()` (L94) signature: extract className/level from the already-passed `sheet` parameter
- [ ] If Barbarian level 7+ (`hasFeralInstinct`), increment `advSources++`
- [ ] If creature is surprised AND has Feral Instinct AND NOT incapacitated, decrement `disadvSources--`
- [ ] NO separate check in `initiateAction()` needed — it already delegates to `computeInitiativeModifiers()` (L321) which drives the RollRequest advantage/disadvantage flags

#### [File: packages/game-server/src/application/services/combat/helpers/resource-utils.ts]

**Rage End Mechanics — Reset Flags (fallback path):**
- [ ] Add `rageAttackedThisTurn: false` and `rageDamageTakenThisTurn: false` to `resetTurnResources()`

#### [File: packages/game-server/src/application/services/combat/helpers/combat-hydration.ts]

**Rage End Mechanics — Reset Flags (primary tabletop path):**
- [ ] In `extractActionEconomy()`, add `rageAttackedThisTurn: isFreshEconomy ? false : (resources as any).rageAttackedThisTurn ?? false` and same for `rageDamageTakenThisTurn`. This mirrors how other turn-scoped flags (sneakAttackUsedThisTurn, stunningStrikeUsedThisTurn) are already reset there.

#### [File: packages/game-server/src/application/services/combat/combat-service.ts]

**Rage End Mechanics — Turn-Start Check (nextTurnDomain path — PRIMARY):**
- [ ] In `nextTurnDomain()`, BEFORE the `extractActionEconomy` loop (~L703): use `outgoingEntityId` (already available at ~L659) to find the outgoing combatant's record. Check if `raging === true` in their resources. If so, read `rageAttackedThisTurn` and `rageDamageTakenThisTurn` from their **current** (pre-reset) resources. If `shouldRageEnd()` returns true, remove all ActiveEffects with `source: "Rage"` and set `raging: false` on that combatant's resources. Persist via `updateCombatantState()`.

**Rage End Mechanics — Turn-Start Check (fallback nextTurn path):**
- [ ] BEFORE calling `resetTurnResources()` (both in new-round path L469 and single-turn path L482): same rage-end check as above.

**Rage End Mechanics — KO Rage End:**
- [ ] When a combatant drops to 0 HP (in the death/KO handling paths), if they have `raging: true`, end their rage immediately. Remove Rage-sourced ActiveEffects and set `raging: false`.

#### [File: packages/game-server/src/application/services/combat/tabletop/saving-throw-resolver.ts]

**Danger Sense Condition Gating:**
- [ ] Before calling `hasAdvantageFromEffects()`, filter the effects array: if the target has any of `["blinded", "deafened", "incapacitated"]` conditions, remove effects with `source === "Danger Sense"` from the array. Then pass the filtered array to `hasAdvantageFromEffects()`. This correctly suppresses Danger Sense without affecting other advantage sources.

#### [File: packages/game-server/src/application/services/combat/ai/ai-action-executor.ts]

**Rage End Mechanics — AI Attack Tracking:**
- [ ] When an AI barbarian makes an attack (resolves attack roll), set `rageAttackedThisTurn: true` on attacker resources
- [ ] When an AI-controlled barbarian takes damage, set `rageDamageTakenThisTurn: true` on target resources

#### [File: packages/game-server/src/application/services/combat/tabletop/two-phase-action-service.ts]

**Rage End Mechanics — Opportunity Attack Damage:**
- [ ] When opportunity attack damage is applied to a target who has `raging: true`, set `rageDamageTakenThisTurn: true` on the target's resources

### EntityManagement

#### [File: packages/game-server/src/infrastructure/llm/mocks/index.ts]

**Unarmored Defense — Mock Generator:**
- [ ] Add a barbarian template to `classTemplates` with typical barbarian stats (STR 16, DEX 14, CON 16), no armor, rage-appropriate equipment (Greataxe, javelins)
- [ ] Add Barbarian case in AC computation: `if className === "barbarian" && !hasArmor → armorClass = 10 + dexMod + conMod`

## E2E Test Scenarios

- [ ] `barbarian/rage-resistance.json` — Barbarian rages, takes B/P/S damage → half damage applied
- [ ] `barbarian/unarmored-defense.json` — Barbarian with no armor, AC = 10 + DEX + CON, attack misses at lower roll
- [ ] `barbarian/rage-ends.json` — Barbarian rages, skips attacking for a full round → rage expires at start of next turn
- [ ] `barbarian/extra-attack.json` — Level 5 Barbarian gets two attacks in one action
- [ ] `barbarian/feral-instinct.json` (optional) — Barbarian level 7+ gets advantage on initiative

## Risks

| # | Risk | Severity | Mitigation |
|---|------|----------|------------|
| 1 | Rage end check ordering: must read flags BEFORE `resetTurnResources()` clears them | High | Clear ordering in code + integration test covers it |
| 2 | Multiple damage paths must all set `rageDamageTakenThisTurn` | Medium | Audit all damage paths: handleDamageRoll, OA, zone damage, AI attacks |
| 3 | Danger Sense condition gating is novel (no precedent in codebase) | Low | Small targeted check in SavingThrowResolver, not a general mechanism |
| 4 | LLM character generator won't know Barbarian Unarmored Defense | Medium | Out of scope — mock generator is sufficient for now |
| 5 | `saving-throws.ts` uses `Math.random()` directly (pre-existing issue) | Low | Not introduced by this task, don't fix now |

## SME Approval
- [ ] ClassAbilities-SME
- [ ] CombatRules-SME
- [ ] CombatOrchestration-SME
- [ ] EntityManagement-SME
