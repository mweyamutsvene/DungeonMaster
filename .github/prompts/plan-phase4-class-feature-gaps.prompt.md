# Plan: Phase 4 — Missing Class Features (Uncanny Dodge, Evasion, Fighting Style, Weapon Mastery Keys)
## Round: 1
## Status: COMPLETE
## Affected Flows: ClassAbilities, CombatRules, CombatOrchestration

## Objective
Implement 5 high-priority class feature gaps: Uncanny Dodge (Rogue 5), Evasion (Rogue 7/Monk 7), Fighting Style (Fighter 1/Paladin 2/Ranger 2), Weapon Mastery feature keys, and Paladin spellcasting feature key fix. These are commonly-used features that are either missing or half-implemented.

## Changes

### ClassAbilities — Uncanny Dodge

#### [File: domain/entities/classes/rogue.ts]
- [x] Add `UNCANNY_DODGE` to the Rogue's `ClassCombatTextProfile` as an `attackReaction` — triggers when the Rogue is hit by an attack, halves the damage
- [x] Define eligibility: must see the attacker, must have reaction available, must be hit (not missed)

#### [File: application/services/combat/two-phase/attack-reaction-handler.ts]
- [x] Handle Uncanny Dodge reaction in the attack-reaction flow: after a hit is confirmed, check if the target has Uncanny Dodge and reaction available
- [x] On use: halve the incoming damage (after all modifiers/resistances)
- [x] Mark reaction as used

### ClassAbilities — Evasion

#### [File: domain/entities/classes/feature-keys.ts]
- [x] Add `EVASION` feature key constant (if not already present for both Rogue and Monk) — already existed

#### [File: domain/entities/classes/rogue.ts]
- [x] Ensure `evasion: 7` is in the Rogue's features map — already existed

#### [File: domain/entities/classes/monk.ts]
- [x] Add `evasion: 7` to the Monk's features map

#### [File: application/services/combat/tabletop/rolls/saving-throw-resolver.ts]
- [x] When resolving a DEX saving throw for damage, check if the creature has the Evasion feature (via `classHasFeature`)
- [x] D&D 2024 Evasion: on a successful DEX save, take NO damage (instead of half). On a failed DEX save, take half damage (instead of full) — implemented in save-spell-delivery-handler; zone-damage-resolver TODO

### ClassAbilities — Fighting Style

#### [File: domain/entities/classes/fighting-style.ts — NEW]
- [x] `FightingStyleId` type with 6 styles defined in `fighting-style.ts`
- [x] Effect functions unified via `FIGHTING_STYLE_TO_FEAT` mapping → `feat-modifiers.ts`:
  - Defense: +1 AC while wearing armor
  - Dueling: +2 damage with one-handed melee weapon
  - Great Weapon Fighting: reroll 1-2 on damage dice
  - Two-Weapon Fighting: add ability modifier to off-hand damage
  - Archery: +2 to ranged attack rolls
  - Protection: impose disadvantage on attack against adjacent ally

#### [File: domain/entities/classes/fighter.ts, paladin.ts, ranger.ts]
- [x] `FIGHTING_STYLE` feature key at appropriate levels: Fighter 1, Paladin 2, Ranger 2
- [x] `fightingStyle` field on character via `getFightingStyle()` / `getFightingStyleFeatId()` methods

#### [File: domain/rules/feat-modifiers.ts]
- [x] Unified via `FIGHTING_STYLE_TO_FEAT` mapping in `fighting-style.ts` — no double-stacking (tested in `fighting-style-attack.test.ts`)

### ClassAbilities — Weapon Mastery Feature Keys

#### [File: domain/entities/classes/fighter.ts]
- [x] Add `weapon-mastery: 1` to features map (Fighter gets 3 weapon masteries at level 1)

#### [File: domain/entities/classes/barbarian.ts]
- [x] Add `weapon-mastery: 1` to features map (Barbarian gets 2 weapon masteries at level 1)

#### [File: domain/entities/classes/paladin.ts]
- [x] Add `weapon-mastery: 1` to features map (Paladin gets 2 weapon masteries at level 1)
- [x] Add `spellcasting: 1` to features map (D&D 2024 Paladin gets spellcasting at level 1!)

#### [File: domain/entities/classes/rogue.ts]
- [x] Add `weapon-mastery: 1` to features map (Rogue gets 2 weapon masteries at level 1)

#### [File: domain/entities/classes/ranger.ts]
- [x] Add `weapon-mastery: 1` to features map (Ranger gets 2 weapon masteries at level 1)

#### [File: domain/entities/classes/feature-keys.ts]
- [x] Add `WEAPON_MASTERY` feature key constant
- [x] Add `FIGHTING_STYLE` feature key constant

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? — Verified: all 812 tests pass, E2E happy-path passes
- [x] Does the pending action state machine still have valid transitions? — Uncanny Dodge is same flow as Shield
- [x] Is action economy preserved? — Uncanny Dodge uses reaction (same as other reactions)
- [x] Do both player AND AI paths handle the change? — Player path: Uncanny Dodge handled via waitForReaction/reactionRespond flow (E2E verified). AI path: AI-controlled combatants would receive uncanny_dodge as "other" reaction type in AiReactionDecider — works generically but no dedicated AI heuristic yet. (Low priority: AI NPC Rogues are rare.)
- [x] Are repo interfaces + memory-repos updated if entity shapes change? — Fighting style stored on sheet, not schema
- [x] Is `app.ts` registration updated if adding executors? — No new ability executors needed
- [x] Are D&D 5e 2024 rules correct? — Verified: Uncanny Dodge unchanged, Evasion unchanged, Fighting Styles updated in 2024, Weapon Mastery is NEW in 2024

## Risks
- **Uncanny Dodge ordering**: Must apply AFTER hit confirmation but BEFORE damage is recorded. Fits naturally in attack-reaction-handler flow.
- **Fighting Style unification with feats**: Existing Archery/GWF/TWF are in feat-modifiers.ts. Needs careful refactoring to avoid double-stacking.
- **Paladin spellcasting at level 1**: 2024 change from 2014 (was level 2). May affect character generation.

## Test Plan
- [x] Unit test: Rogue Uncanny Dodge halves attack damage when reaction available
- [x] Unit test: Uncanny Dodge requires seeing attacker
- [x] Unit test: Uncanny Dodge not available when reaction already used
- [x] Unit test: Evasion — DEX save success = hasEvasion flag set (damage adjustment in handlers)
- [x] Unit test: Evasion — DEX save fail = hasEvasion flag set (damage adjustment in handlers)
- [x] Unit test: Fighting Style Defense gives +1 AC with armor (3 tests in `fighting-style-attack.test.ts`: with armor, without armor, without style)
- [x] Unit test: Fighting Style Dueling gives +2 damage one-handed (in `fighting-style-attack.test.ts`)
- [x] Unit test: Weapon Mastery feature keys exist on martial classes
- [x] Unit test: Paladin has spellcasting at level 1
- [x] E2E scenario: uncanny-dodge.json — Rogue halves damage with reaction (9/9 steps, `rogue/uncanny-dodge.json`)
- [x] E2E scenario: evasion-dex-save.json — Evasion verified via two-monster AoE test: Rogue Scout (Evasion) takes 0 damage on successful save, Goblin takes half (7/7 steps, `rogue/evasion-dex-save.json`)
