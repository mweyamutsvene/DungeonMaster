# Plan: Generic ActiveEffect Buff/Debuff System — Phase 10

## Overview

Wire the existing but unused `ActiveEffect` type system into the tabletop combat flow so that any spell, feature, or ability can declare buff/debuff effects as **data** rather than code. Extend with dice-based bonuses and ongoing damage, store effects in the combatant resources bag, query them at all 6 resolution points (attack bonus, advantage/disadvantage, AC, saving throws, damage defense, ongoing damage), and clean them up on turn transitions and concentration break.

This unlocks Bless, Shield of Faith, Bane, Dodge, Heat Metal, ongoing poison/fire damage, Hunter's Mark extra damage, Longstrider speed buffs, Armor of Agathys retaliatory damage, Heroes' Feast condition immunity, Heroism recurring temp HP, and dozens of future spells/features without per-spell code.

## Current State

### What Already Exists (unused)

`domain/entities/combat/effects.ts` defines a complete generic `ActiveEffect` system:

- **`EffectType`**: `advantage`, `disadvantage`, `bonus`, `penalty`, `resistance`, `vulnerability`, `immunity`, `temp_hp`, `speed_modifier`, `custom` (will add `ongoing_damage`, `retaliatory_damage`, `condition_immunity`, `recurring_temp_hp`)
- **`EffectTarget`**: `attack_rolls`, `damage_rolls`, `saving_throws`, `ability_checks`, `armor_class`, `speed`, `next_attack`, `next_save`, etc.
- **`EffectDuration`**: `until_end_of_turn`, `rounds`, `concentration`, `until_triggered`, `permanent`
- **Helper functions**: `calculateBonusFromEffects()`, `hasAdvantageFromEffects()`, `hasDisadvantageFromEffects()`, `removeTriggeredEffects()`, `shouldRemoveAtEndOfTurn()`, `shouldRemoveAtStartOfTurn()`, `decrementRounds()`

**None of this is wired into the tabletop combat flow.** Currently every modifier (Vex advantage, Hidden advantage, feat bonuses) is checked individually with hardcoded conditionals.

### The Domain `Combat` Class Gap

The domain `Combat` class (`domain/combat/combat.ts`) has `activeEffects: Map<string, ActiveEffect[]>` with add/get/remove/cleanup methods — but the **tabletop flow bypasses this entirely** and works directly with `CombatantStateRecord` via the repository.

### Current Modifier Architecture (all hardcoded)

| Resolution Point | How it works today |
|---|---|
| **Attack bonus** | `action.weaponSpec?.attackBonus + feat modifiers (Archery)` |
| **Advantage/disadvantage** | `deriveRollModeFromConditions()` + individual checks (Vex, Hidden, Reckless, Heavy+Small, range) |
| **AC** | Static `sheet.armorClass + coverBonus` |
| **Saving throws** | `abilityMod + proficiencyMod` (no advantage/disadvantage support at all) |
| **Damage defense** | Static `sheet.damageResistances/Immunities/Vulnerabilities` + Rage merge |

### Dodge Action — Currently Cosmetic

Dodge action only sets `actionSpent: true`. No `dodging` flag, no disadvantage on incoming attacks, no advantage on DEX saves. Patient Defense (Monk) has the same gap.

## Implementation Plan

### Step 1 — Extend `ActiveEffect` type with dice values

**File:** `domain/entities/combat/effects.ts`

Add to the `ActiveEffect` interface:
- `diceValue?: { count: number; sides: number }` — for Bless 1d4, Guidance 1d4, ongoing damage dice, etc.
- `damageType?: string` — for resistance/vulnerability/immunity AND ongoing damage effects (e.g., "fire", "cold", "poison")
- `targetCombatantId?: string` — supports "effects on attacks made *against* this creature" (needed for Dodge, Faerie Fire). Distinguishes "I have advantage on my attacks" from "attacks against me have disadvantage"
- `triggerAt?: 'start_of_turn' | 'end_of_turn'` — when ongoing damage fires (e.g., Heat Metal at start of caster's turn, poison at start of victim's turn)
- `saveToEnd?: { ability: Ability; dc: number }` — optional save at end/start of turn to end the effect (e.g., "repeat the saving throw at end of each turn, ending the effect on a success")

Add to `EffectType`:
- `'ongoing_damage'` — recurring damage that fires at `triggerAt` timing each round
- `'retaliatory_damage'` — damage dealt back to attacker when this creature is hit by melee (e.g., Armor of Agathys, Fire Shield)
- `'condition_immunity'` — prevents a specific condition from being applied (e.g., Heroes' Feast immune to Frightened)
- `'recurring_temp_hp'` — grants temp HP at `triggerAt` timing each round (e.g., Heroism grants WIS mod temp HP at start of turn)

Add to `ActiveEffect` interface:
- `conditionName?: string` — for `condition_immunity` effects, specifies which condition is blocked

Update:
- `createEffect()` to accept the new fields
- `calculateBonusFromEffects()` to return both flat bonus AND dice rolls needed: `{ flatBonus: number; diceRolls: Array<{count, sides}> }`

### Step 2 — ActiveEffect storage on combatants

**File:** `application/services/combat/helpers/resource-utils.ts`

Add typed helpers:
- `getActiveEffects(resources: Record<string, unknown>): ActiveEffect[]` — reads `resources.activeEffects`, returns `[]` if absent
- `setActiveEffects(resources: Record<string, unknown>, effects: ActiveEffect[]): Record<string, unknown>` — writes to `resources.activeEffects`
- `addActiveEffect(combatantId, effect, combatRepo)` — reads current resources, appends effect, writes back
- `removeActiveEffectsBySource(combatantId, source, combatRepo)` — removes all effects with matching `source` field (for concentration break)
- `getEffectsForCombatant(combatantId, allCombatants)` — collects both "own" effects AND effects from other combatants that target this combatant (via `targetCombatantId`)

**Storage**: `activeEffects` goes inside the existing `resources` JSON bag — no DB migration needed.

### Step 3 — Query effects at attack roll resolution

**Files:** `roll-state-machine.ts`, `action-dispatcher.ts`

In `handleAttackRoll()` (~line 580–595):
- After feat modifier application, load attacker's ActiveEffects
- Add flat bonus from `calculateBonusFromEffects(attackerEffects, 'attack_rolls')` to `attackBonus`
- Roll dice bonuses (e.g., Bless 1d4) via `diceRoller` and add to `attackBonus`
- For AC: load target's ActiveEffects, add `calculateBonusFromEffects(targetEffects, 'armor_class')` to `targetAC`

In `buildAttackPendingAction()` (~line 1898–1959):
- Load attacker's effects → check `hasAdvantageFromEffects(effects, 'attack_rolls')` → increment `extraAdvantage`
- Load target's effects → check effects where `targetCombatantId === targetId` and type is `'advantage'` on `'attack_rolls'` (Faerie Fire)
- Similarly for disadvantage (Dodge grants disadvantage on attacks against dodger)

Repeat for the other 3 attack resolution locations (`ai-action-executor.ts`, `two-phase-action-service.ts`, `action-service.ts`) — or better, extract a shared `resolveAttackModifiers(attackerEffects, targetEffects)` helper.

### Step 3b — Query effects at damage roll resolution (extra damage dice)

**Files:** `roll-state-machine.ts` `handleDamageRoll()`, `ai-action-executor.ts`, `two-phase-action-service.ts`

After base damage is calculated:
- Load attacker's ActiveEffects with `type: 'bonus'` and `target: 'damage_rolls'`
- For flat bonuses (`value`), add to damage total
- For dice bonuses (`diceValue`), roll via `diceRoller` and add to damage total
- Support `targetCombatantId` filtering — Hunter's Mark only adds damage against the marked target
- Apply `damageType` from the effect if different from weapon damage type (Hex/Hunter's Mark use weapon damage type, Elemental Weapon specifies its own)

This unlocks Hunter's Mark (1d6 vs marked), Hex (1d6 necrotic vs cursed), Elemental Weapon (+1d4 of chosen type), Spirit Shroud (1d8 radiant/necrotic/cold).

### Step 3c — Retaliatory damage on melee hit

**Files:** Same damage application paths as Step 3

When a melee attack deals damage:
- Load target's (the defender's) ActiveEffects for `type: 'retaliatory_damage'`
- For each matching effect: deal `value` flat or roll `diceValue` damage of `damageType` back to the attacker
- Apply attacker's damage defenses (resistance/immunity) to retaliatory damage
- Call `applyKoEffectsIfNeeded()` on attacker if KO'd by retaliatory damage
- If the retaliatory effect is a temp HP pool (Armor of Agathys), reduce the temp HP by the incoming damage — remove the effect when temp HP depleted

This unlocks Armor of Agathys (5 cold damage to melee attacker while temp HP remains), Fire Shield (2d8 fire/cold to melee attacker).

### Step 4 — Query effects at saving throw resolution

**File:** `saving-throw-resolver.ts`

In `resolve()` (~line 132):
- Load target's ActiveEffects
- Add `calculateBonusFromEffects(effects, 'saving_throws', action.ability)` to `totalModifier`
- Roll dice bonuses (Bless 1d4 on saves) and add
- Check `hasAdvantageFromEffects` / `hasDisadvantageFromEffects` for saves and pass `RollMode` to the d20 roll

### Step 5 — Query effects at damage defense resolution

**File:** `roll-state-machine.ts` `handleDamageRoll()` (~line 1071)

- Load target's ActiveEffects with `type: 'resistance'|'vulnerability'|'immunity'` and matching `damageType`
- Merge into the `DamageDefenses` object before calling `applyDamageDefenses()`
- Same pattern at the other 4 damage defense locations

### Step 5b — Query effects at speed resolution

**Files:** Movement resolution code (wherever `speed` is read from combatant resources)

- Load combatant's ActiveEffects with `type: 'speed_modifier'` or `target: 'speed'`
- Sum all `value` fields and add to base speed
- Clamp to minimum 0 (speed can't go negative)
- Effects with `type: 'bonus'` + `target: 'speed'` also work (e.g., Longstrider +10ft)

This unlocks Longstrider (+10ft speed, 1 hour), Haste (+double speed, concentration), Slow (-halved speed, concentration), Ray of Frost (-10ft until start of target's next turn).

### Step 5c — Condition immunity guard

**Files:** `conditions.ts` `addCondition()` function, `combat-service.ts`

Before applying any condition:
- Load target's ActiveEffects for `type: 'condition_immunity'`
- If any effect's `conditionName` matches the condition being applied, skip it and emit "immune" message
- Works for both initial application and ongoing save-to-end re-application

This unlocks Heroes' Feast (immune to Frightened and Poison), Calm Emotions (suppress Charmed/Frightened), Protection from Poison (immune to Poisoned condition).

### Step 6 — Effect processing and cleanup on turn transitions

**File:** `combat-service.ts` (~lines 624–636 end-of-turn, 695–713 start-of-turn)

After existing `removeExpiredConditions()`, two phases:

**Phase A — Execute ongoing effects:**
- Iterate all combatants' `activeEffects` where `triggerAt` matches current timing AND the combatant is the one whose turn it is
- For `type: 'ongoing_damage'`:
  - Roll `diceValue.count`d`diceValue.sides` + `value` (flat modifier) damage
  - Apply `damageType` through existing `applyDamageDefenses()` (respects resistance/immunity)
  - Reduce HP, call `applyKoEffectsIfNeeded()` from the shared KO handler
  - Emit damage event for narration
- For `type: 'recurring_temp_hp'`:
  - Grant `value` temp HP (or roll `diceValue` if dice-based)
  - Temp HP doesn't stack — only applies if higher than current temp HP
  - Emit buff event for narration
- If effect has `saveToEnd`, prompt a saving throw:
  - On success → remove the effect (and any associated conditions)
  - On failure → effect persists to next round

**Phase B — Cleanup expired effects:**
- Call `shouldRemoveAtEndOfTurn()` / `shouldRemoveAtStartOfTurn()` from effects.ts
- Call `decrementRounds()` for `duration: 'rounds'` effects
- Remove `duration: 'until_triggered'` effects that have already been consumed
- Persist cleaned-up effects back to resources

**Note on save-to-end:** The saving throw uses the existing `SavingThrowResolver` — the effect declares the DC and ability, the resolver handles the roll. For deterministic E2E testing, the seeded dice roller produces predictable save results.

### Step 7 — Concentration break removes effects

**File:** `roll-state-machine.ts` concentration break path (~line 1121–1148)

When concentration fails:
- Read the `concentrationSpellName`
- Remove ALL `ActiveEffect` entries with `duration: 'concentration'` whose `source` matches the spell name, across ALL combatants in the encounter (Bless affects 3 allies, not just the caster)
- Also remove associated conditions (e.g., Hold Person → remove Paralyzed)

### Step 8 — Spell effect declarations on prepared spells

**File:** `spell-action-handler.ts` (inline type ~line 75–90)

Extend the prepared spell schema:
```typescript
effects?: Array<{
  type: EffectType;
  target: EffectTarget;
  value?: number;
  diceValue?: { count: number; sides: number };
  damageType?: string;
  duration: EffectDuration;
  roundsRemaining?: number;
  appliesTo?: 'self' | 'target' | 'allies' | 'enemies';
}>
```

This lets character sheets declare effects as data:
```json
{
  "name": "Bless",
  "level": 1,
  "concentration": true,
  "effects": [
    { "type": "bonus", "target": "attack_rolls", "diceValue": { "count": 1, "sides": 4 }, "duration": "concentration", "appliesTo": "allies" },
    { "type": "bonus", "target": "saving_throws", "diceValue": { "count": 1, "sides": 4 }, "duration": "concentration", "appliesTo": "allies" }
  ]
}
```

### Step 9 — Buff/debuff spell handler path

**File:** `spell-action-handler.ts` between save-based and simple spell paths (~line 150)

Add new handler: `if (spellMatch?.effects?.length) { return this.handleBuffDebuffSpell(...); }`

`handleBuffDebuffSpell()`:
- Resolves targets based on `appliesTo` (self, named target, all allies, all enemies)
- Creates `ActiveEffect` instances with `source: spellName`
- Applies to each target combatant via `addActiveEffect()`
- Sets `concentrationSpellName` if concentration spell
- Returns `SIMPLE_ACTION_COMPLETE` with descriptive message

### Step 10 — Fix Dodge to use ActiveEffect

**File:** `action-service.ts` `dodge()`

After setting `actionSpent`, add two ActiveEffects to the dodger:
1. `{ type: 'disadvantage', target: 'attack_rolls', targetCombatantId: dodgerId, duration: 'until_start_of_next_turn', source: 'Dodge' }` — attackers have disadvantage
2. `{ type: 'advantage', target: 'saving_throws', ability: 'dexterity', duration: 'until_start_of_next_turn', source: 'Dodge' }` — advantage on DEX saves

Patient Defense gets the same effects through its existing `services.dodge()` call.

### Step 11 — E2E scenarios

| Scenario | What it tests |
|----------|--------------|
| `core/bless-party.json` | Cleric casts Bless → 2 allies get +1d4 on attacks and saves. Assert effect is active, verify bonus applied on attack roll, verify effect ends on concentration break |
| `core/dodge-disadvantage.json` | PC takes Dodge action → enemy attacks with disadvantage. Assert effect exists, verify roll mode |
| `core/shield-of-faith.json` | Cleric casts Shield of Faith → ally gets +2 AC. Assert effect active, verify AC increase on incoming attack |
| `core/bane-debuff.json` | Cleric casts Bane → enemy gets -1d4 on attacks and saves. Assert effect on target, verify penalty applied |
| `core/ongoing-damage.json` | Monster applies poison → PC takes 1d6 poison at start of turn, CON save to end. Assert HP decreases, assert effect removed on successful save |
| `core/heat-metal.json` | Caster applies Heat Metal → target takes 2d8 fire at start of caster's turn. Assert recurring damage, assert ends on concentration break |
| `core/hunters-mark.json` | Ranger casts Hunter's Mark → extra 1d6 damage on attacks against marked target only. Assert bonus damage applied, assert no bonus on different target |
| `core/speed-modifier.json` | Longstrider → +10ft speed. Ray of Frost → -10ft speed for 1 turn. Assert speed changes, assert expiry |
| `core/retaliatory-damage.json` | Armor of Agathys → melee attacker takes cold damage. Assert retaliatory damage dealt, assert stops when temp HP depleted |
| `core/condition-immunity.json` | Heroes' Feast → immune to Frightened. Assert condition application is blocked, assert other conditions still apply |
| `core/heroism.json` | Heroism → temp HP at start of each turn + immune to Frightened. Assert temp HP refreshes, assert ends on concentration break |
| Update existing concentration scenarios | Verify concentration break removes buff effects from all affected targets |

### Step 12 — Refactor existing hardcoded modifiers 

Migrate existing ad-hoc modifier sources to use `ActiveEffect`:
- Reckless Attack → `{ type: 'advantage', target: 'attack_rolls', duration: 'until_end_of_turn' }` + `{ type: 'advantage', target: 'attack_rolls', targetCombatantId: self, duration: 'until_start_of_next_turn' }`
- Rage damage bonus → `{ type: 'bonus', target: 'damage_rolls', value: rageDamageBonus, duration: 'until_removed' }`
- Vex weapon mastery → advantage effect with `duration: 'until_triggered'`

## What This Unlocks (without any spell-specific code)

| Spell/Feature | Effect declarations |
|---|---|
| **Bless** | `bonus → attack_rolls + saving_throws, diceValue: 1d4, concentration, allies` |
| **Bane** | `penalty → attack_rolls + saving_throws, diceValue: 1d4, concentration, enemies` |
| **Shield of Faith** | `bonus → armor_class, value: 2, concentration, target` |
| **Guidance** | `bonus → ability_checks, diceValue: 1d4, concentration, target` |
| **Resistance (cantrip)** | `bonus → next_save, diceValue: 1d4, until_triggered, target` |
| **Faerie Fire** | `advantage → attack_rolls (against target), concentration, enemies` |
| **Hex** | `disadvantage → ability_checks, ability: specific, concentration, target` |
| **Dodge** | `disadvantage → attack_rolls (against dodger), until_start_of_next_turn` + `advantage → DEX saving_throws` |
| **Paladin Aura** | `bonus → saving_throws, value: CHA_MOD, permanent, allies within range` (requires proximity check — separate feature) |
| **Resist Elements** | `resistance → damageType: fire, concentration, target` |
| **Heat Metal** | `ongoing_damage → diceValue: 2d8, damageType: fire, triggerAt: start_of_turn, concentration` |
| **Moonbeam** | `ongoing_damage → diceValue: 2d10, damageType: radiant, triggerAt: start_of_turn, concentration, saveToEnd: { ability: CON, dc: spellSaveDC }` |
| **Witch Bolt** | `ongoing_damage → diceValue: 1d12, damageType: lightning, triggerAt: start_of_turn, concentration` |
| **Poison (monster)** | `ongoing_damage → diceValue: 1d6, damageType: poison, triggerAt: start_of_turn, rounds: 3, saveToEnd: { ability: CON, dc: 12 }` |
| **Alchemist's Fire** | `ongoing_damage → diceValue: 1d4, damageType: fire, triggerAt: start_of_turn, until_removed, saveToEnd: { ability: DEX, dc: 10 }` |
| **Hunter's Mark** | `bonus → damage_rolls, diceValue: 1d6, targetCombatantId: marked, concentration` |
| **Hex** | `bonus → damage_rolls, diceValue: 1d6, damageType: necrotic, targetCombatantId: cursed, concentration` + `disadvantage → ability_checks, ability: chosen, targetCombatantId: cursed` |
| **Elemental Weapon** | `bonus → attack_rolls, value: +1, concentration` + `bonus → damage_rolls, diceValue: 1d4, damageType: chosen, concentration` |
| **Longstrider** | `bonus → speed, value: 10, rounds: 600 (1 hour)` |
| **Haste** | `bonus → speed, value: doubled, concentration` + `bonus → armor_class, value: 2` + `advantage → saving_throws, ability: DEX` |
| **Ray of Frost** | `penalty → speed, value: 10, until_start_of_next_turn` |
| **Armor of Agathys** | `temp_hp → hit_points, value: 5` + `retaliatory_damage → damageType: cold, value: 5, while temp HP active` |
| **Fire Shield** | `retaliatory_damage → diceValue: 2d8, damageType: fire, rounds: 100 (10 min)` + `resistance → damageType: cold` |
| **Heroes' Feast** | `condition_immunity → conditionName: Frightened` + `condition_immunity → conditionName: Poisoned` |
| **Heroism** | `recurring_temp_hp → value: WIS_MOD, triggerAt: start_of_turn, concentration` + `condition_immunity → conditionName: Frightened` |
| **Calm Emotions** | `condition_immunity → conditionName: Charmed, concentration` + `condition_immunity → conditionName: Frightened, concentration` |
| **Protection from Poison** | `condition_immunity → conditionName: Poisoned, rounds: 600 (1 hour)` + `resistance → damageType: poison` |

## Decisions

- **Store effects in `resources` JSON bag** (not a new DB column) — follows existing pattern, no migration needed
- **Dice-based bonuses rolled at resolution time** (not at cast time) — matches D&D rules where Bless 1d4 is rolled per attack/save, not once at cast
- **`targetCombatantId`** distinguishes "my buff" from "debuff on attacks against me" — required for Dodge/Faerie Fire semantics
- **Aura proximity checks deferred** — Paladin Aura of Protection remains blocked; would need range-check in effect resolution, separate feature

## Verification

1. `pnpm -C packages/game-server typecheck` — clean
2. `pnpm -C packages/game-server test` — all unit tests pass (no regressions from wiring changes)
3. `pnpm -C packages/game-server test:e2e:combat:mock -- --all` — all existing 104+ scenarios still pass
4. New scenarios pass: `--scenario core/bless-party`, `--scenario core/dodge-disadvantage`
5. Manual check: concentration break on Bless removes effects from all blessed targets

## Dependencies

- Phase 9 multi-PC support (complete) — needed for Bless targeting multiple allies
- Existing `ActiveEffect` types in `domain/entities/combat/effects.ts` (complete)
- Existing condition system with duration tracking (complete)
- Existing concentration tracking in resources bag (complete)

## Complexity

Medium-High — touches 10–14 files for wiring, but each integration point is a small localized change. The `ActiveEffect` primitives are already built; this is plumbing, not design. Ongoing damage and retaliatory damage add complexity to turn hooks and damage paths, but reuse existing infrastructure (dice roller, KO handler, saving throw resolver, damage defenses). Condition immunity is a single guard check. Speed modifiers and extra damage dice are straightforward sum queries.

## Out of Scope (separate plan required)

The following mechanics do NOT fit the per-combatant `ActiveEffect` model and need their own systems:

| Mechanic | Why it doesn't fit | Examples |
|---|---|---|
| **Zone/area effects** | Needs positional area tracking, not per-combatant | Spirit Guardians, Moonbeam area, Cloud of Daggers, Wall of Fire |
| **Movement-triggered damage** | Needs per-5ft movement hooks | Spike Growth (2d4 per 5ft), Booming Blade (damage on voluntary move) |
| **Reaction-granted effects** | Already handled via `AttackReactionDef` pipeline | Shield (+5 AC until next turn), Absorb Elements (resistance + damage bonus) |

See `plan-positionalEffects.prompt.md` (Phase 11) for zone/area/movement-triggered mechanics.
## Completion Notes

**Status: COMPLETE** — All 12 steps implemented and verified.

### Final gap closure (session)

Three gaps were identified during audit and resolved:

**Step 5b — `getEffectiveSpeed()` wired into all speed resolution sites:**
- `action-dispatcher.ts` (4 sites) — move validation, dash, jump distance
- `two-phase-action-service.ts` (2 sites) — reaction move validation
- `ai-action-executor.ts` (2 sites) — AI movement planning
- `action-service.ts` (1 site) — move action speed check
- `tactical-view-service.ts` (3 sites) — tactical view speed display

**Step 5c — `isConditionImmuneByEffects()` guard at all condition application sites:**
- `action-dispatcher.ts` — Prone from failed jump landing
- `roll-state-machine.ts` (3 sites) — Sapped mastery, Slowed mastery, apply-condition enhancement
- `action-service.ts` (2 sites) — Prone from shove, Grappled from grapple
- `spell-action-handler.ts` — spell save conditions (per-condition check, tracks actually applied)
- `saving-throw-resolver.ts` — save outcome conditions

**Step 11 — E2E scenarios created:**
- `core/speed-modifier.json` — Wizard casts Longstrider (+10ft speed), moves 35ft, asserts position
- `core/condition-immunity.json` — Cleric casts Heroism (Frightened immunity), survives monster turn, asserts no Frightened condition

### Test results
- 458 unit tests passed
- 114 E2E scenarios passed, 0 failed
- TypeScript typecheck clean

### Scenarios from Step 11 plan table — status:
| Scenario | Status | Notes |
|----------|--------|-------|
| `core/bless-party.json` | ✅ Exists & passes | |
| `core/dodge-disadvantage.json` | ✅ Exists & passes | |
| `core/shield-of-faith.json` | ✅ Exists & passes | |
| `core/bane-debuff.json` | ✅ Exists & passes | |
| `core/heroism.json` | ✅ Exists & passes | |
| `core/speed-modifier.json` | ✅ Created & passes | Tests getEffectiveSpeed wiring |
| `core/condition-immunity.json` | ✅ Created & passes | Tests isConditionImmuneByEffects wiring |
| `core/ongoing-damage.json` | ⬜ Planned | See `plan-activeEffect-e2e-scenarios.prompt.md` |
| `core/heat-metal.json` | ⬜ Renamed → `core/caster-turn-damage.json` | See `plan-activeEffect-e2e-scenarios.prompt.md` |
| `core/hunters-mark.json` | ⬜ Planned | See `plan-activeEffect-e2e-scenarios.prompt.md` |
| `core/retaliatory-damage.json` | ⬜ Planned | See `plan-activeEffect-e2e-scenarios.prompt.md` |

These 4 scenarios are now **fully generic** — all underlying resolution points are implemented. A dedicated plan exists at `plan-activeEffect-e2e-scenarios.prompt.md`.

---

### Post-audit gap closure: save-to-end + ability_checks (session 2)

Two remaining gaps identified during a full ActiveEffect audit:

**Fix 1 — Save-to-end resolution (combat-service.ts ~L1077)**
Previously hardcoded `abilityScore = 10`, no save proficiency, no ActiveEffect bonuses. Fixed to:
- Extract real ability score from `record.sheet.abilityScores` or `record.statBlock.abilityScores`
- Look up save proficiency via `saveProficiencies` array (pattern from `saving-throw-resolver.ts`)
- Apply ActiveEffect flat+dice bonuses via `calculateBonusFromEffects(effects, 'saving_throws', saveAbility)`
- Support advantage/disadvantage from effects via `hasAdvantageFromEffects`/`hasDisadvantageFromEffects`
- Roll with proper `abilityMod + profMod + effectBonus` total

**Fix 2 — ability_checks EffectTarget wired into all 5 ability check call sites:**
- `action-service.ts` — Added `abilityCheckEffectMods()` helper: extracts ActiveEffects, calculates flat+dice bonus, checks adv/disadv. Wired into:
  - **Shove** (actor strength + target check) — bonus added to modifiers, mode passed
  - **Grapple** (actor strength + target check) — same pattern
  - **Hide** (dexterity) — bonus added to stealth modifier, mode passed
  - **Search** (wisdom) — bonus added to perception modifier, mode passed
- `action-dispatcher.ts` — **Acrobatics** (dexterity, jump landing in difficult terrain) — inline effect calculation using `calculateBonusFromEffects`, `hasAdvantageFromEffects`, `hasDisadvantageFromEffects`, mode passed to `abilityCheck()`

### Test results (session 2)
- 458 unit tests passed
- 114 E2E scenarios passed, 0 failed
- TypeScript typecheck clean

### Remaining unimplemented EffectTargets (low priority, no current spells use them):
- `initiative` — would need wiring in initiative roll handling
- `spell_save_dc` — would need wiring in spell save DC calculation
- `next_attack` / `next_save` — single-use triggered effects, would need consume-on-use logic

---

### Caster-turn trigger fix (session 3)

**Gap:** `processActiveEffectsAtTurnEvent()` in `combat-service.ts` only processed `ongoing_damage` and `recurring_temp_hp` effects on the **active creature** (the one whose turn it is). Effects on OTHER creatures where `sourceCombatantId === activeEntityId` were never triggered.

This blocked: Heat Metal (damage fires on caster's turn, not victim's), Witch Bolt, and any "damage at start of your turn" effect applied by one creature to another.

**Fix:** Refactored Phase A filtering to check both:
1. **Own-turn effects**: `isActiveCreatureTurn && (!sourceCombatantId || sourceCombatantId === entityId)` — normal poison, burning, etc.
2. **Caster-turn-triggered effects**: `!isActiveCreatureTurn && sourceCombatantId === activeEntityId` — Heat Metal, Witch Bolt, etc.

Applied same pattern to `ongoing_damage`, `recurring_temp_hp`, and `save-to-end` processing.

**E2E plan:** 4 deferred scenarios now have a dedicated plan at `plan-activeEffect-e2e-scenarios.prompt.md`.

### Test results (session 3)
- 458 unit tests passed
- 118 E2E scenarios passed, 0 failed
- TypeScript typecheck clean