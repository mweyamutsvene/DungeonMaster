# Combat Scenario Expansion — Phased Implementation Plan
IMPORTANT!!  if you run into unexpected behavior during testing and implementation for items outside of these scenarios, or what you would expect from D&D 5e rules, please flag it immediately. This plan is based on our current understanding of the rules and existing codebase, but we may discover new edge cases or necessary changes as we go. Document TODOs and open issues for any gaps or unexpected behaviors you encounter, even if they fall outside the scope of these specific scenarios. The goal is to ensure a comprehensive and accurate combat system, and your feedback is crucial to achieving that.


## TL;DR
56 scenarios now exist and pass covering core action economy, basic attacks, movement, death saves, critical hits, conditions (prone/grapple), off-hand attacks, damage resistance, ranged attacks, Sneak Attack, Fighter/Monk/Rogue/Wizard/Barbarian/Paladin/Cleric abilities, opportunity attacks, spellcasting, feat modifiers, difficult terrain, rest recovery, and AI bonus actions. **Phases 1–5 are COMPLETE. Phase 6 mostly complete** — only Ready Action (6.1) and Weapon Mastery (6.6) remain as multi-day features with dedicated plan docs.

---

## Phase 1: Core Combat Completeness (death, crits, conditions) ✅ COMPLETE

All domain logic exists. Highest value, lowest effort. **All scenarios passing 43/43.**

**1.1 — Death Saving Throws** ✅ (`core/death-save.json`)
- Fighter takes lethal damage → 0 HP → death save rolls → stabilize or die
- Wire `death-saves.ts` into TabletopCombatService: detect 0 HP → enter death save state → prompt for rolls → track successes/failures
- Test harness needs new action type `deathSave` or reuse `rollResult` with death save context
- Cover: nat 20 (regain 1 HP), nat 1 (2 failures), 3 success/fail outcomes

**1.2 — Critical Hits & Misses** ✅ (`core/critical-hit.json`)
- Fighter attacks with nat 20 → validate doubled damage dice; nat 1 → auto-miss
- Already handled in `attack-resolver.ts` — just needs scenario assertions
- Setup: low AC target (easy crit validation), high AC target (nat 1 still misses)

**1.3 — Condition Effects Validation** ✅ (`core/prone-effects.json`, `core/grappled-effects.json`)
- Shove prone → melee advantage + ranged disadvantage + half movement to stand
- Grapple → speed 0 enforcement (monster can't move), break free contested check
- All logic in `conditions.ts` — needs scenario-level validation

**1.4 — Off-hand Attack** ✅ (`core/offhand-attack.json`)
- Fighter with two light weapons → Attack (action) → Off-hand (bonus action, no modifier)
- `OffhandAttackExecutor` already exists in `executors/common/`
- Just needs scenario file + character sheet with two light weapons

---

## Phase 2: Monk Ability Coverage (7 untested executors) ✅ COMPLETE

All executors built. All scenario files created and passing.

**2.1 — Martial Arts Bonus Strike** ✅ (`monk/martial-arts.json`) — Weapon attack → free unarmed bonus strike (no Ki). Validates martial arts die from `martial-arts-die.ts`

**2.2 — Step of the Wind** ✅ (`monk/step-of-the-wind.json`, `monk/step-of-the-wind-dash.json`) — Bonus action, 1 Ki → Dash or Disengage. `StepOfTheWindExecutor` exists.

**2.3 — Deflect Attacks** ✅ (`monk/deflect-attacks.json`) — Reaction: reduce incoming damage by 1d10 + DEX + level. Needs wiring into reaction flow (similar to OA prompt architecture). `DeflectAttacksExecutor` exists.

**2.4 — Stunning Strike** ✅ (`monk/stunning-strike.json`) — On hit: 1 Ki → target CON save vs Ki DC → Stunned condition. `StunningStrikeExecutor` exists. Validates Stunned condition mechanics.

**2.5 — Open Hand Technique** ✅ (`monk/open-hand-technique.json`) — Flurry of Blows + per-hit choice: push 15ft / prone / no reactions. `OpenHandTechniqueExecutor` exists.

**2.6 — Patient Defense positive test** ✅ (`monk/patient-defense.json`) — Bonus action, 1 Ki → Dodge effect. Currently only rejection-tested in bonus-action-economy.json.

**2.7 — Uncanny Metabolism + Wholeness of Body** ✅ (`monk/uncanny-metabolism.json`, `monk/wholeness-of-body.json`) — Ki recovery + self-heal. Both executors exist.

---

## Phase 3: Spellcasting Depth ✅ COMPLETE

**3.1 — Spell Slot Consumption** ✅ (`wizard/spell-slots.json`) — Cast leveled spell → slot consumed → cast until empty → rejection. Full slot management in `spell-slots.ts`.

**3.2 — Concentration** ✅ (`wizard/concentration.json`) — Cast concentration spell → take damage → CON save (DC = max(10, dmg/2)) → fail = lose spell. Logic in `concentration.ts`. Needs wiring into damage handling.

**3.3 — Spell Save DC & Attack Rolls** ✅ (`wizard/spell-attacks.json`) — Fire Bolt spell attack roll. Save-based spell (e.g. Burning Hands) with DEX save.

**3.4 — Shield Reaction** ✅ (`wizard/shield-reaction.json`) — Monster attacks → Wizard reacts with Shield → +5 AC → miss. Two-phase attack service already has `hasShield = false` stub — just needs spell detection + slot consumption.

---

## Phase 4: Damage System & Ranged Combat ✅ COMPLETE

**4.1 — Damage Resistance/Vulnerability/Immunity** ✅ (`core/damage-resistance.json`) — Pure function `applyDamageDefenses()` in `domain/rules/damage-defenses.ts`. Wired through all 7 damage application points (attack-resolver, action-service, tabletop-combat-service handleDamageRoll + save spells, two-phase-action-service, ai-action-executor). `CombatantCombatStats` extracts defenses for Character/Monster/NPC. Scenario: Fighter vs Fire Elemental with bludgeoning resistance (9 → 4 damage).

**4.2 — Ranged Attack Rules** ✅ (`core/ranged-attack.json`) — `WeaponSpec` now has `normalRange`/`longRange` fields. `handleAttackAction` improved: weapon kind inferred from weapon data (not just text keywords), weapon lookup prefers matching kind, range validation (beyond long range = error), long range disadvantage, ranged-in-melee disadvantage (hostile within 5ft). `deriveRollModeFromConditions` accepts extra advantage/disadvantage sources. Mock intent parser now recognizes "shoot/fire at/strike". Scenario: Fighter with Longbow at 60ft.

**4.3 — Cover** — DEFERRED (lower priority, complex geometry)

**4.4 — Sneak Attack** ✅ (`rogue/sneak-attack.json`) — `isSneakAttackEligible()` domain function in `rogue.ts`. `WeaponSpec` has `properties?: string[]` for finesse detection. Auto-detected in `handleAttackRoll` on hit: checks rogue class + finesse/ranged weapon + advantage or ally within 5ft + once-per-turn tracking. Sneak attack dice included in damage formula (doubled on crit per 5e 2024). `sneakAttackUsedThisTurn` tracked in combatant resources, reset at turn start. `DamagePendingAction` has `sneakAttackDice` field. Hidden condition grants advantage via `deriveRollModeFromConditions`. Scenario: Level 5 Rogue with NPC ally adjacent to target (3d6 SA dice).

---

## Phase 5: New Class Executors (Barbarian, Cleric, Paladin) ✅ COMPLETE

**5.1 — Barbarian: Rage + Reckless Attack** ✅
- New executors: `RageExecutor`, `RecklessAttackExecutor` in `executors/barbarian/`
- Domain: `BARBARIAN_COMBAT_TEXT_PROFILE` with "rage" (bonusAction) + "reckless-attack" (classAction), `rageDamageBonusForLevel()` helper
- Combat wiring: rage damage bonus + B/P/S resistance in `roll-state-machine.ts`, reckless attack advantage in `action-dispatcher.ts`
- `handleBonusAbility` fixed to merge `updatedResources` from executors (was silently discarding rage flags)
- `extractActionEconomy` fixed to reset per-turn flags (`recklessAttack`, `sneakAttackUsedThisTurn`, `stunningStrikeUsedThisTurn`, `bonusActionUsed`, `reactionUsed`)
- Two scenarios: `barbarian/rage.json` (13/13 — bonus damage + B/P/S resistance), `barbarian/reckless-attack.json` (11/11 — advantage + resets next turn)

**5.2 — Paladin: Divine Smite + Lay on Hands** ✅
- New executor: `LayOnHandsExecutor` in `executors/paladin/` (pool-based healing, bonus action cost)
- Domain: `PALADIN_COMBAT_TEXT_PROFILE` with Divine Smite `attackEnhancement` (hit-rider pipeline) + Lay on Hands `bonusAction`, `divineSmiteDice()` helper
- Combat wiring: Divine Smite as hit-rider in `roll-state-machine.ts` — finds lowest spell slot, spends slot + bonus action, builds `HitRiderEnhancement` with bonus dice (2d8+ radiant)
- `extractActionEconomy` fixed `bonusActionUsed`/`bonusActionSpent` naming mismatch (was preventing second-turn bonus actions)
- Two scenarios: `paladin/divine-smite.json` (14/14 — 2d8 radiant on hit, slot consumed, works across turns), `paladin/lay-on-hands.json` (7/7 — pool-based healing)

**5.3 — Cleric: Channel Divinity (Turn Undead)** ✅
- New executor: `TurnUndeadExecutor` in `executors/cleric/` — validates Channel Divinity pool, calculates save DC, returns AoE effect data
- Domain: `CLERIC_COMBAT_TEXT_PROFILE` with "turn-undead" classAction, fixed `channelDivinityUsesForLevel()` to 2024 rules (2/3/4 not 1/2/3)
- AoE post-processing in `handleClassAbility`: iterates all Monster combatants, filters by `statBlock.type === "undead"` + within 30ft, auto-resolves WIS saves via `SavingThrowResolver`, applies Frightened condition on failure
- One scenario: `cleric/turn-undead.json` (8/8 — Skeleton Frightened, Goblin unaffected, CD pool spent)
- ✅ `cleric/cure-wounds.json` also passes (pre-existing)

---

## Phase 6: Advanced Mechanics

**6.1 — Ready Action** — DEFERRED (multi-day feature). See `.github/prompts/plan-ready-action.prompt.md` for detailed plan. Needs trigger specification, held action tracking, reaction consumption. Type defined in `SpecificActionType` but no parser/handler.

**6.2 — Monster Nimble Escape** ✅ (`core/goblin-nimble-escape.json`) — AI-driven goblin uses Nimble Escape: Hide as bonus action. Extended MockAiDecisionMaker with `defaultBonusAction` support. Fixed miss path to execute bonus actions. 12-step scenario validates full AI bonus action flow.

**6.3 — Feat Modifier Validation** ✅ (`core/feat-archery.json`) — Archery feat +2 ranged attack bonus wired into `handleAttackRoll()` in `roll-state-machine.ts`. Alert feat initiative bonus wired into `handleInitiativeRoll()`. 8-step scenario validates ranged attack with Archery bonus.

**6.4 — Rest Recovery** ✅ (`core/short-rest-recovery.json`) — New `POST /sessions/:id/rest` endpoint. `CharacterService.takeSessionRest()` refreshes class resource pools via `refreshClassResourcePools()`. Long rest restores HP to max + spell slots. New `updateSheet()` repository method. New `rest` action type in scenario runner. 3-step scenario validates Fighter secondWind + actionSurge refresh.

**6.5 — Difficult Terrain** ✅ (`core/difficult-terrain.json`) — Combat map created during encounter initialization. `TwoPhaseActionService.initiateMove()` now checks terrain + condition speed modifiers. New `PATCH /sessions/:id/combat/terrain` endpoint. New `setTerrain` action type in scenario runner. 7-step scenario validates movement cost doubling.

**6.6 — 2024 Weapon Mastery** — DEFERRED (multi-day feature). See `.github/prompts/plan-weapon-mastery.prompt.md` for detailed plan. New domain models needed for 8 mastery properties (Cleave, Graze, Nick, Push, Sap, Slow, Topple, Vex).

**6.7 — AI Bonus Action Cleanup** ✅ — Removed dead legacy stubs for `offhand_attack` and `flurry_of_blows` in `ai-action-executor.ts`. Both are properly wired through the AbilityRegistry path. Nimble Escape (hide/disengage), Cunning Action (dash/disengage/hide), Patient Defense, and Step of the Wind all work end-to-end via registry.

**6.8 — Infrastructure Cleanup** ✅ — Deleted duplicate `spellcasting-service.ts` (zero imports). Fixed reactions.ts combatant name resolution + status lookup.

---

## Phase Dependencies

```
Phase 1 (no deps — all domain logic exists)
    ↓
Phase 2 (needs Phase 1.3 patterns for condition validation)
    ↓
Phase 3 (needs Phase 1 damage/HP tracking patterns)
    ↓
Phase 4 (needs Phase 3 for spell system + Phase 1 for damage types)
    ↓
Phase 5 (needs Phase 4.1 for damage resistance + Phase 3 for spell slots)
    ↓
Phase 6 (independent, can partially parallelize with Phase 5)
```

## Verification

Each scenario runnable via `pnpm -C packages/game-server test:e2e:combat:mock`. Per-scenario: `pnpm -C packages/game-server test:e2e:combat:mock -- "--scenario=<path>"`. All 43 existing scenarios must continue passing after each phase.

---

## Decisions

- **Phase 1 first** — covers the most critical 5e gaps (death, crits) with zero new domain code needed
- **Monk before new classes** — 7 executors already exist; scenarios validate them, low effort vs building Barbarian/Cleric/Paladin from scratch
- **Spellcasting before damage system** — concentration + slots are more fundamental than resistance/cover
- **Ready action last** — most complex new mechanic, lowest priority for combat testing
- **2024 Weapon Mastery deferred** — requires entirely new domain model, no existing code to build on
