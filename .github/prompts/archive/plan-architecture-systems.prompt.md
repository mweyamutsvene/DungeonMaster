# Architecture Systems Plan — Cross-Cutting Combat Infrastructure

## Overview

This document describes **5 cross-cutting systems** that were built to support the phased combat scenarios. All 5 systems are **✅ COMPLETE and PRODUCTION**. This document serves as architecture reference — no remaining work items.

---

## Status of Existing Systems

| System | State | Used By |
|--------|-------|---------|
| Tabletop Pending Action State Machine | **PRODUCTION** | INITIATIVE → ATTACK → DAMAGE → DEATH_SAVE → SAVING_THROW chain |
| Two-Phase Reaction Framework | **PRODUCTION** (OA + Shield + Deflect Attacks + Absorb Elements + Hellish Rebuke) | Opportunity attacks on movement, Shield spell, Deflect Attacks, Absorb Elements, Hellish Rebuke reactions |
| Resource Pool Management | **PRODUCTION** | Ki, Action Surge, Second Wind, Wholeness of Body, Spell Slots |
| Combat Resource Builder | **PRODUCTION** | `buildCombatResources()` — single domain function initializes all resource pools + spell slots + `hasShieldPrepared` + `hasCounterspellPrepared` + `hasAbsorbElementsPrepared` + `hasHellishRebukePrepared` from class + level + sheet |
| Class Combat Text Profiles | **PRODUCTION** | `ClassCombatTextProfile` pattern — class-specific text patterns, ability IDs, attack enhancements, and **attack reactions** co-located in domain class files |
| Profile-Driven Action Dispatch | **PRODUCTION** | `tryMatchClassAction()` + `matchAttackEnhancements()` + `detectAttackReactions()` — replaces hardcoded per-class parsers in action-dispatcher and two-phase-service |
| ClassFeatureResolver | **PRODUCTION** | Static helpers (`isMonk`, `isFighter`, `isRogue`, `hasStunningStrike`, `hasCunningAction`, `hasDeflectAttacks`, `hasUncannyMetabolism`, `getClassCapabilities`, etc.) |
| Class Capabilities System | **PRODUCTION** | `capabilitiesForLevel()` on `CharacterClassDefinition` — generic class feature descriptions for Monk, Fighter, Rogue; `getClassCapabilities()` in ClassFeatureResolver for any class |
| Attack Reaction Detection | **PRODUCTION** | `AttackReactionDef` + `detectAttackReactions()` in `combat-text-profile.ts` — class-declared reaction eligibility (Shield on Wizard, Deflect Attacks on Monk), `initiateAttack()` iterates generically |
| Damage Reaction Detection | **PRODUCTION** | `DamageReactionDef` + `detectDamageReactions()` in `combat-text-profile.ts` — post-damage reactions (Absorb Elements on Wizard, Hellish Rebuke on Warlock), `completeAttack()` + `ai-action-executor` iterate generically |
| Spell Reaction Detection | **PRODUCTION** | `SpellReactionDef` + `detectSpellReactions()` in `combat-text-profile.ts` — spell-interruption reactions (Counterspell on Wizard), `initiateSpellCast()` iterates generically. AI spellcasting wired through `AiActionExecutor.executeCastSpell()` → two-phase flow. E2E: `wizard/counterspell`. |
| Saving Throw Resolution | **PRODUCTION** | `SavingThrowResolver` + `SavingThrowPendingAction` + `handleSavingThrowAction()` — auto-resolves saves in tabletop flow with condition application |
| Condition Tracking | **PRODUCTION** (unified structured storage) | `ActiveCondition[]` stored directly in DB `conditions` column. `readConditionNames()` for reads, `addCondition()`/`removeCondition()`/`createCondition()` for writes. Both `start_of_turn` + `end_of_turn` expiry wired in `CombatService.nextTurn()` |
| Feat Modifiers in Tabletop Flow | **PRODUCTION** | `computeFeatModifiers()` wired into `handleAttackRoll()` (Archery +2 ranged) + `handleInitiativeRoll()` (Alert proficiency bonus) in roll-state-machine.ts |
| Difficult Terrain + Combat Maps | **PRODUCTION** | `createCombatMap()` called during encounter creation. `getTerrainSpeedModifier()` wired into `initiateMove()`. `PATCH /sessions/:id/combat/terrain` endpoint for setting terrain zones. |
| Rest Recovery API | **PRODUCTION** | `POST /sessions/:id/rest` endpoint. `CharacterService.takeSessionRest()` calls `refreshClassResourcePools()`. `updateSheet()` repository method for persisting pool changes. |
| AI Bonus Action Pipeline | **PRODUCTION** | All bonus actions routed through AbilityRegistry. Dead legacy stubs removed. Working: Nimble Escape, Cunning Action, Patient Defense, Step of the Wind, Offhand Attack, Flurry of Blows (all via registry). |
| Spell Pipeline | **PRODUCTION** (core paths) | `SpellActionHandler` — spell slot spending, attack spells through ATTACK chain, save spells auto-resolved, concentration tracking + break on damage |
| Hit-Rider Enhancement Pipeline | **PRODUCTION** | `HitRiderEnhancement` type + `DamagePendingAction.enhancements[]` + bonus dice loop + `resolvePostDamageEffect()` → `SavingThrowResolver` / condition application — Stunning Strike + Open Hand Technique fully wired |

---

## Completed Infrastructure: Profile-Driven Class Combat System

These systems are **already built and tested**. They form the scalable foundation that the remaining work can leverage.

### Combat Resource Builder (`domain/entities/classes/combat-resource-builder.ts`)
- `buildCombatResources({ className, level, sheet })` → `{ resourcePools, hasShieldPrepared, hasCounterspellPrepared, hasAbsorbElementsPrepared, hasHellishRebukePrepared }`
- Single source of truth for combat resource pool initialization (replaces ~70 lines of class-specific if/else in `handleInitiativeRoll`)
- Each class defines pools via `CharacterClassDefinition.resourcesAtLevel(level)` in its domain file
- Monk pools: ki, uncanny_metabolism, wholeness_of_body (wisdom-aware via sheet)
- Fighter pools: actionSurge, secondWind
- Spell slot pools: initialized from `sheet.spellSlots`
- Shield detection: `hasShieldPrepared` flag for reaction framework
- Counterspell detection: `hasCounterspellPrepared` flag for spell reaction framework
- Absorb Elements detection: `hasAbsorbElementsPrepared` flag for damage reaction framework
- Hellish Rebuke detection: `hasHellishRebukePrepared` flag for damage reaction framework
- Extensible: add `resourcesAtLevel()` to any class definition file

### Class Combat Text Profiles (`domain/entities/classes/combat-text-profile.ts`)
Profile-driven system that eliminates hardcoded class-specific maps from parsers and dispatchers:

```typescript
interface ClassCombatTextProfile {
  classId: string;
  actionMappings: readonly ClassActionMapping[];      // text pattern → ability ID + category
  attackEnhancements: readonly AttackEnhancementDef[]; // hit-rider declarations (e.g. Stunning Strike)
}
```

**Key components:**
- **`ClassActionMapping`**: Maps normalized text patterns → `abilityId` + `category` ("bonusAction" | "classAction")
- **`AttackEnhancementDef`**: Declares attack-rider abilities with level gate, resource cost, turn tracking, melee requirement
- **`tryMatchClassAction(text, profiles)`**: Pure function — scans all profiles for text match, returns `{ keyword, abilityId, category }`
- **`matchAttackEnhancements(text, attackKind, classId, level, turnFlags, resourcePools, profiles)`**: Pure function — filters enhancements by eligibility, returns matched keyword list

**Registered profiles:**
- `MONK_COMBAT_TEXT_PROFILE` in `monk.ts` — 6 action mappings (flurry, patient-defense, step-of-the-wind[-dash], martial-arts, wholeness-of-body) + stunning-strike enhancement + deflect-attacks reaction
- `FIGHTER_COMBAT_TEXT_PROFILE` in `fighter.ts` — 2 action mappings (action-surge as classAction, second-wind as bonusAction)
- `WIZARD_COMBAT_TEXT_PROFILE` in `wizard.ts` — shield attack reaction + absorb-elements damage reaction + counterspell spell reaction
- `WARLOCK_COMBAT_TEXT_PROFILE` in `warlock.ts` — hellish-rebuke damage reaction
- Collected by `getAllCombatTextProfiles()` in `registry.ts`

**How action-dispatcher uses profiles:**
1. `classAction = tryMatchClassAction(text, getAllCombatTextProfiles())`
2. If matched: route by `classAction.category` → `handleClassAbility()` or `handleBonusAbility()`
3. During attacks: `matchAttackEnhancements()` replaces the old `parseStunningStrike()` inline function
4. During `initiateAttack()`: `detectAttackReactions()` replaces inline Shield/Deflect Attacks if-blocks

**Adding a new class's combat abilities:**
1. Define a `ClassCombatTextProfile` const in the class's domain file (e.g. `paladin.ts`)
2. Register it in `registry.ts` → `COMBAT_TEXT_PROFILES` array
3. Done — no parser, dispatcher, or two-phase-service changes needed

**Adding a new attack reaction (e.g. Parry):**
1. Add an `AttackReactionDef` to the class's `ClassCombatTextProfile.attackReactions` array
2. Add resolution logic in `completeAttack()` if the reaction has a unique effect
3. Done — `initiateAttack()` picks it up automatically via `detectAttackReactions()`

**Adding a new damage reaction (e.g. Fire Shield):**
1. Add a `DamageReactionDef` to the class's `ClassCombatTextProfile.damageReactions` array
2. Add resolution logic in `completeDamageReaction()` if needed
3. Done — `completeAttack()` and `ai-action-executor` detect it via `detectDamageReactions()`

**Adding a new spell reaction (e.g. Silvery Barbs):**
1. Add a `SpellReactionDef` to the class's `ClassCombatTextProfile.spellReactions` array
2. Add resolution logic in `completeSpellCast()` if needed
3. Done — `initiateSpellCast()` detects it via `detectSpellReactions()`

---

## System 1: Saving Throw Resolution (Tabletop) — ✅ DONE

**Needed by**: Stunning Strike (Phase 2), Spell Saves (Phase 3.3), Open Hand Technique (Phase 2), Turn Undead (Phase 5)

### Implementation (complete)
- `SavingThrowPendingAction` type in `tabletop-types.ts` — full interface with `actorId`, `sourceId`, `ability`, `dc`, `reason`, `onSuccess`, `onFailure`, `context`
- `SaveOutcome` type — conditions add/remove, damage, movement, `speedModifier`, summary
- `SavingThrowResolver` class in `saving-throw-resolver.ts` — `buildPendingAction()`, `resolve()`, `buildResult()`
  - Handles d20 roll + ability mod + proficiency vs DC
  - Applies conditions with structured `expiresAt` from context
  - Stores both structured `ActiveCondition[]` and legacy `string[]` formats
- `handleSavingThrowAction()` in `RollStateMachine` — auto-resolves saves without player input, clears pending action, generates narration
- Dispatcher routing in `processRollResult()` — auto-routes `SAVING_THROW` pending actions
- `PendingActionType` union includes `"SAVING_THROW"`

### Integration Points (wired)
- **Stunning Strike**: Fully wired through generic enhancement pipeline → `resolvePostDamageEffect("saving-throw")` → `SavingThrowResolver.resolve()`
- **Spell saves**: `SpellActionHandler.handleSaveSpell()` auto-rolls inline (does NOT create `SavingThrowPendingAction` — see System 5 gaps)
- **Open Hand Technique**: Fully wired through generic enhancement pipeline → `resolvePostDamageEffect()` (Push/Topple use `"saving-throw"`, Addle uses `"apply-condition"`)

### Remaining Work
- ~~**Migrate `SpellActionHandler.handleSaveSpell()`** to create `SavingThrowPendingAction` instead of inline d20 rolls~~ — CLOSED (won't-fix). Inline approach is simpler, fully functional, and passes all E2E scenarios. Formal pending action only needed if future player save prompts are desired.

---

## System 2: Post-Hit Enhancement System (Hit-Riders) — ✅ DONE

**Used by**: Stunning Strike (Phase 2), Divine Smite (Phase 5), Open Hand Technique (Phase 2)

### What's Built
- **Detection phase (PRODUCTION)**: `AttackEnhancementDef` + `matchAttackEnhancements()` — text-based declaration of hit-riders is profile-driven
  - Stunning Strike detection uses `MONK_COMBAT_TEXT_PROFILE.attackEnhancements`
  - `matchAttackEnhancements()` checks: class match, level gate, melee requirement, resource cost (ki pool), once-per-turn flag
- **Types (PRODUCTION)**: `HitRiderEnhancement` + `HitRiderEnhancementResult` interfaces in `tabletop-types.ts` — `abilityId`, `displayName`, `bonusDice`, `postDamageEffect`, `context`; result includes `saved`, `saveRoll`, `saveTotal`, `saveDC`, `conditionApplied`
- **`DamagePendingAction.enhancements[]` field** — array of `HitRiderEnhancement` for stacking multiple riders
- **Bonus dice loop in `handleDamageRoll()`** — iterates `action.enhancements`, applies `bonusDice` (dice rolling + HP reduction). Works for Divine Smite pattern.
- **`resolvePostDamageEffect()` in `RollStateMachine`** — generic handler for post-damage effects:
  - `"saving-throw"`: Spends resources (ki), builds `SavingThrowPendingAction` via `SavingThrowResolver.buildPendingAction()`, auto-resolves via `resolve()`, returns structured result with save details
  - `"apply-condition"`: Directly applies condition to target (e.g. Addled from Open Hand Technique)
- **Enhancement builder in `handleAttackRoll()`** — builds `HitRiderEnhancement[]` from `stunningStrike` and `openHandTechnique` flags with full save parameters, DCs, outcomes
- **Enhancement results** appended to damage summary and returned in response
- **Backward compatibility** — maps enhancement results to legacy `stunningStrike` and `openHandTechnique` response fields by `abilityId`

### Completed Migrations
- ✅ **Stunning Strike**: Migrated from `MonkTechniqueResolver.resolveStunningStrike()` to `resolvePostDamageEffect("saving-throw")` via `SavingThrowResolver`
- ✅ **Open Hand Technique (Push/Topple)**: Migrated from `MonkTechniqueResolver.resolveOpenHandTechnique()` to `resolvePostDamageEffect("saving-throw")` via `SavingThrowResolver`
- ✅ **Open Hand Technique (Addle)**: Migrated from `MonkTechniqueResolver.resolveOpenHandTechnique()` to `resolvePostDamageEffect("apply-condition")`
- ✅ **`MonkTechniqueResolver` DELETED** — all functionality absorbed into generic enhancement pipeline

### Completed Enhancements
- ✅ **Divine Smite**: `PALADIN_COMBAT_TEXT_PROFILE.attackEnhancements` has `divine-smite` entry. `handleAttackRoll()` finds spell slot, calls `divineSmiteDice()`, adds radiant bonus dice as `HitRiderEnhancement`. E2E: `paladin/divine-smite` (14 steps).
- ✅ **Sneak Attack**: Works via inline detection in `handleAttackRoll()` — NOT a hit-rider (pre-roll effect, dice added to damage formula before roll). Uses `isSneakAttackEligible()` from `rogue.ts`. Different pattern than post-damage hit-riders, intentionally not migrated to `AttackEnhancementDef`. E2E: `rogue/sneak-attack` (8 scenarios).

### No remaining implementation steps — System 2 is complete

---

## System 3: Player Reaction During AI Turns — ✅ DONE

**Needed by**: Deflect Attacks (Phase 2), Shield spell (Phase 3.4), Counterspell (Phase 3), Absorb Elements, Hellish Rebuke

### What's Built
- **Three-Tier Reaction Framework (PRODUCTION)**:
  - **Pre-damage reactions** (`AttackReactionDef`): `initiateAttack()` → `detectAttackReactions()` → Shield (+5 AC), Deflect Attacks (dmg reduction + ki redirect)
  - **Post-damage reactions** (`DamageReactionDef`): `completeAttack()` / `ai-action-executor` → `detectDamageReactions()` → Absorb Elements (halve + heal), Hellish Rebuke (2d10 fire retaliation)
  - **Spell reactions** (`SpellReactionDef`): `initiateSpellCast()` → `detectSpellReactions()` → Counterspell (CON save vs spell DC)
  - All three tiers use the same profile-driven detection + two-phase pending action + REST API response pattern
- **Damage Reaction Flow (PRODUCTION)**:
  - `initiateDamageReaction()` creates pending action after damage is applied
  - `completeDamageReaction()` resolves Absorb Elements (heal back half, spend slot) or Hellish Rebuke (2d10 fire, DEX save for half, spend slot)
  - `completeAttack()` returns `damageReaction?` field for the route handler
  - `reactions.ts` handles `damage_reaction` pending action type — creates new pending action, waits for player, resumes AI turns after response
- **Counterspell (PRODUCTION — ✅ COMPLETE)**:
  - `initiateSpellCast()` uses `detectSpellReactions()` with profile-driven Counterspell detection (60ft range, level 3+ slot, reaction available)
  - `completeSpellCast()` resolves Counterspell with actual CON save vs counterspeller's spell save DC (8 + proficiency + INT mod), spends slot, marks reaction
  - `AiActionExecutor.executeCastSpell()` now uses two-phase flow: calls `initiateSpellCast()`, pauses for player reaction if Counterspell eligible, resumes via `reactions.ts` → `completeSpellCast()`
  - `reactions.ts` handles `spell_cast` pending action type: auto-completes via `completeSpellCast()`, resumes AI turns
  - `MockAiDecisionMaker` supports `castSpell` behavior: reads from monster `statBlock.spells[]`
  - `AiContextBuilder` exposes `spells` for Monster combatants
- **AI turn pause for player reactions (PRODUCTION)**: `ai-action-executor.ts` detects when target has any reactions (Shield, Deflect, damage reactions), routes through two-phase flow, waits for player response
- **`fallbackSimpleTurn()` (FIXED)**: Now delegates to `actionExecutor.executeAttack()` instead of `actionService.attack()` — supports all reaction types
- **AI reaction decision**: `aiDecideReaction()` in `ai-turn-orchestrator.ts` handles OA and `shield_spell` decisions for AI-controlled monsters

### E2E Scenarios (all passing)
- `wizard/shield-reaction` — Shield spell (+5 AC) during monster attack
- `monk/deflect-attacks` — Deflect Attacks damage reduction
- `monk/deflect-attacks-redirect` — Deflect Attacks ki redirect (ranged unarmed strike)
- `wizard/absorb-elements` — Absorb Elements retroactive resistance (heal half fire damage)
- `warlock/hellish-rebuke` — Hellish Rebuke retaliatory fire damage (2d10, DEX save)
- `wizard/counterspell` — Counterspell interrupts monster spell (CON save vs spell DC, slot 3 spent, reaction marked)

### Remaining Work
- ~~**AI reaction decisions for damage reactions**: Currently auto-prompted to player. AI-controlled characters could auto-decide whether to use damage reactions.~~ — CLOSED (won't-fix). Edge case only applies to AI-controlled NPC characters with wizard/warlock spells — a theoretical scenario not currently exercised. Player prompt is the correct default.

---

## System 4: Structured Condition Tracking — ✅ DONE

**Needed by**: Stunning Strike (Stunned condition with duration), Open Hand Technique (addle disadvantage), Spell effects (Hold Person = Paralyzed), Barbarian Rage (resistance tracking)

### What's Built
- **`ActiveCondition` type** in `domain/entities/combat/conditions.ts` — full interface with `condition`, `duration`, `roundsRemaining`, `source`, `appliedAtRound`, `appliedAtTurnIndex`, `expiresAt`
- **`Condition` type** includes standard D&D 5e conditions + game-specific: `Hidden`, `Addled`, `StunningStrikePartial`
- **`ConditionDuration` enum** — `instant`, `until_end_of_turn`, `until_start_of_next_turn`, `until_end_of_next_turn`, `rounds`, `until_removed`, `permanent`
- **Helper functions (PRODUCTION)**:
  - `createCondition()` — factory with `expiresAt` support
  - `normalizeConditions()` — converts `string[]` → `ActiveCondition[]` (backward compat)
  - `readConditionNames()` — reads condition names as `string[]` from raw DB column (handles both formats)
  - `isActiveConditionArray()` — type guard
  - `conditionsToStringArray()` — reverse conversion
  - `addCondition()` / `removeCondition()` / `hasCondition()`
  - `removeExpiredConditions(conditions, event, combatantId)` — handles `start_of_turn` and `end_of_turn` events, duration-based expiry
  - `canTakeActions()`, `canTakeBonusActions()`, `canTakeReactions()`, `canMove()` — condition effect queries
  - `hasAttackAdvantage()`, `hasAttackDisadvantage()` — roll mode derivation
- **Unified `ActiveCondition[]` storage**: All condition writers store structured `ActiveCondition[]` directly in the DB `conditions` column (Prisma `Json` type). Dead `resources.activeConditions` channel removed.
- **All condition readers** use `readConditionNames()` or `normalizeConditions()` to handle both legacy and structured formats
- **All condition writers** use `normalizeConditions()` + `addCondition()` / `removeCondition()` / `createCondition()` for type-safe mutations
- **Turn advancement hooks (PRODUCTION)**:
  - `end_of_turn` expiry: `removeExpiredConditions("end_of_turn", outgoingEntityId)` runs **before** turn advances
  - `start_of_turn` expiry: `removeExpiredConditions("start_of_turn", activeEntityId)` runs **after** turn advances
- **`SavingThrowResolver`** creates structured conditions with `expiresAt` from context, stores `ActiveCondition[]` directly
- **`SpellActionHandler`** uses `createCondition()` + `addCondition()` for spell condition application
- **`ActionService`** uses structured conditions for Hide, Shove (Prone), and Grapple
- **Legacy `stunnedUntilTurnOf` safety net**: ✅ Removed. Structured `ActiveCondition` expiry handles all Stunned tracking.

### No remaining implementation steps — System 4 is complete

---

## System 5: Spell Resolution Pipeline (Tabletop) — ✅ DONE

**Used by**: Phase 3 (all 4 items), Phase 5 (Cleric/Paladin spells)

### What's Built
- **`SpellActionHandler` class** in `spell-action-handler.ts` — full spell resolution extracted from TabletopCombatService
- **Spell lookup from prepared spells**: Reads `character.sheet.preparedSpells[]` by name (case-insensitive match)
- **Spell slot spending (PRODUCTION)**: For leveled spells, checks `hasResourceAvailable` and calls `spendResourceFromPool` for the appropriate slot level
- **Attack spells (PRODUCTION)**: `handleSpellAttack()` builds a `WeaponSpec` from spell data, creates an `AttackPendingAction` → routes into normal ATTACK → DAMAGE chain
- **Save spells (PRODUCTION)**: `handleSaveSpell()` auto-rolls save (d20 + ability mod + proficiency), applies damage with half-on-save, applies conditions on failure, applies `applyDamageDefenses()` for resistances/immunities
- **Concentration tracking (PRODUCTION)**:
  - Stores `concentrationSpellName` in combatant resources
  - Handles replacing existing concentration when casting a new concentration spell
  - Break on damage: `roll-state-machine.ts` checks `concentrationSpellName` after damage → auto-rolls CON save (DC = max(10, floor(damage/2))) → removes on failure
- **Spell slot initialization**: `buildCombatResources()` already initializes spell slot pools from `sheet.spellSlots`
- **`hasShieldPrepared` flag**: Set by `buildCombatResources()`, read by two-phase reaction framework

### What Was Missing (all resolved)
- ~~**Healing spells**~~ — ✅ DONE: `handleHealingSpell()` added. E2E: `cleric/cure-wounds`.
- ~~**Shield as reaction spell**~~ — ✅ DONE: Shield works through the two-phase reaction framework (`AttackReactionDef` in `WIZARD_COMBAT_TEXT_PROFILE`) — not through `SpellActionHandler`. Slot consumption + AC boost handled in `completeAttack()`. E2E: `wizard/shield-reaction`.
- ~~**`SpellLookupService` (DB-backed) not used**~~ — CLOSED (accepted). `SpellActionHandler` uses `preparedSpells[]` from character sheet, which is the correct source of truth for the tabletop flow. `SpellLookupService` remains available for future DB-backed spell enrichment if needed.
- ~~**Save spells don't use formal `SavingThrowPendingAction`**~~ — CLOSED (won't-fix). Inline approach is simpler, fully functional, and passes all E2E scenarios.

### No remaining implementation steps — System 5 is complete

---

## System Dependencies

```
System 1 (Saving Throws) — ✅ DONE
    ↑ used by
    ├── System 2 (Hit-Riders: Stunning Strike save after damage — fully wired)
    └── System 5 (Spell Pipeline: save spells use inline rolls, not formal pending action)

System 3 (Player Reactions) — ✅ DONE
    ↑ used by
    └── System 5 (Shield reaction spell ✅, Counterspell ✅, Absorb Elements ✅, Hellish Rebuke ✅)

System 4 (Structured Conditions) — ✅ DONE
    ↑ used by
    ├── System 1 (save outcomes apply structured conditions ✅)
    ├── System 2 (hit-rider conditions like Stunned — via generic enhancement pipeline + SavingThrowResolver)
    └── System 5 (spell conditions — ✅ migrated to structured ActiveCondition[])

System 5 (Spell Pipeline) — ✅ DONE
    ↑ depends on
    ├── System 1 (for save-based spells — inline approach, fully functional)
    ├── System 3 (for Shield/Counterspell reactions — ✅ all wired and working)
    └── System 4 (for spell-applied conditions — ✅ migrated to structured)
```

### Build Order (updated — reflecting actual state)

**All complete (PRODUCTION):**
- ✅ `buildCombatResources()` — centralized resource pool initialization + spell slots + Shield detection
- ✅ `ClassCombatTextProfile` — profile-driven text parsing + attack enhancement detection
- ✅ `tryMatchClassAction()` / `matchAttackEnhancements()` — pure matching functions
- ✅ `getAllCombatTextProfiles()` — profile registry in domain layer
- ✅ `capabilitiesForLevel()` — generic class capability descriptions (Monk, Fighter, Rogue)
- ✅ `getClassCapabilities()` — generic lookup in ClassFeatureResolver
- ✅ **System 1** — Saving Throw Resolution (types, resolver, handler, dispatcher routing)
- ✅ **System 2** — Hit-Rider Enhancement Pipeline (Stunning Strike, Open Hand Technique, Divine Smite)
- ✅ **System 3** — Player Reaction During AI Turns (three-tier: pre-damage, post-damage, spell reactions)
- ✅ **System 4** — Structured Conditions (unified `ActiveCondition[]` storage, expiry hooks)
- ✅ **System 5** — Spell Pipeline (slot spending, attack/save/healing spells, concentration, Shield/Counterspell/Absorb Elements/Hellish Rebuke reactions)

### No remaining work — all 5 systems are complete.

---

## Phase Mapping (updated)

| Phase | Systems Needed | Status | Notes |
|-------|---------------|--------|-------|
| Phase 2 (hard monks) | 1 (saves), 2 (hit-riders), 4 (conditions) | **✅ Complete** | All 3 systems fully implemented and wired. |
| Phase 3 (spells) | 1 (saves), 4 (conditions), 5 (spell pipeline) | **✅ Complete** | All systems working. Healing spells ✅. Shield reaction ✅. Counterspell ✅. |
| Phase 4 (damage/ranged) | — | **✅ Complete** | Damage resistance, ranged attacks, Sneak Attack all wired. |
| Phase 5 (new classes) | 2 (hit-riders), 5 (spell pipeline) | **✅ Complete** | Divine Smite via hit-rider pipeline ✅. Lay on Hands, Turn Undead, Rage, Reckless Attack all done. |
| Phase 6 (advanced) | 3 (reactions) | **✅ Complete** | Three-tier reaction framework complete. Remaining: Ready Action + Weapon Mastery (separate plans). |
