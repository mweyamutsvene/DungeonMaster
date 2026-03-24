# Plan: 2024 Weapon Mastery (Phase 6.6)

## Overview

D&D 5e 2024 introduces **Weapon Mastery** — each weapon has a mastery property (Cleave, Graze, Nick, Push, Sap, Slow, Topple, Vex) that can be used by characters with the Weapon Mastery class feature. This is a new system with no existing code.

## D&D 5e 2024 Rules (Equipment Chapter)

### Mastery Properties

| Property | Effect | Trigger |
|----------|--------|---------|
| **Cleave** | On melee hit → free attack roll against a second creature within 5ft (weapon damage, no ability modifier). Once per turn. | Hit |
| **Graze** | On miss → deal ability modifier damage (same type as weapon). | Miss |
| **Nick** | Light property's extra attack is part of Attack action (not Bonus Action). Once per turn. | Attack action |
| **Push** | On hit → push creature up to 10ft away (Large or smaller). | Hit |
| **Sap** | On hit → target has Disadvantage on next attack roll before your next turn. | Hit |
| **Slow** | On hit + deal damage → reduce target Speed by 10ft until start of your next turn. Max 10ft reduction. | Hit |
| **Topple** | On hit → force CON save (DC 8 + ability mod + proficiency). Fail = Prone. | Hit |
| **Vex** | On hit + deal damage → Advantage on next attack against that creature before end of your next turn. | Hit |

### Class Feature: Weapon Mastery

Available to: Fighter (level 1, most weapons), Barbarian (level 1), Paladin (level 1), Ranger (level 1), Rogue (level 1, 2 weapons). Each class grants mastery with a certain number of weapon types.

## Current State

- **No code exists** for weapon mastery
- Weapons have `mastery?: string` in the equipment parser output (from `import-rulebook.ts`)
- `WeaponSpec` in `domain/entities/items/weapon.ts` does NOT have a `mastery` field
- Character sheets do NOT track which weapons the character has mastery with
- No `WeaponMasteryProperty` type or enum

## Implementation Plan

### Step 1: Domain Types (1 day)

- Add `WeaponMasteryProperty` type: `"cleave" | "graze" | "nick" | "push" | "sap" | "slow" | "topple" | "vex"`
- Add `mastery?: WeaponMasteryProperty` to `WeaponSpec`
- Add `weaponMasteries?: string[]` to character sheet — list of weapon names/types the character has mastery with
- Add `hasWeaponMastery(sheet, weaponName): boolean` domain helper

### Step 2: Hit-Effect Integration (2-3 days)

Two integration points based on when effects trigger:

**On-Hit Effects (Cleave, Push, Sap, Slow, Topple, Vex):**
- After damage resolution in `handleDamageRoll()` / `attack-resolver.ts`:
  - Check if attacker has mastery for the weapon used
  - Apply mastery effect:
    - **Cleave**: Create a secondary attack action against adjacent creature (new pending action or auto-resolve)
    - **Push**: Apply 10ft push (reuse Open Hand Technique push infrastructure)
    - **Sap**: Apply Disadvantage condition on target's next attack (new condition or `ActiveCondition`)
    - **Slow**: Reduce target speed by 10ft via `speedModifier` or condition
    - **Topple**: Force CON save → Prone (reuse `SavingThrowResolver`)
    - **Vex**: Grant Advantage on next attack vs target (track in attacker resources)

**On-Miss Effect (Graze):**
- In `handleAttackRoll()` miss path:
  - Check if attacker has mastery for the weapon
  - Deal ability modifier as damage (no dice)

**Action Modification (Nick):**
- In off-hand attack flow:
  - If weapon has Nick mastery, Light extra attack is part of Attack action (doesn't cost Bonus Action)
  - Modify `OffhandAttackExecutor` or attack action handler

### Step 3: Once-Per-Turn Tracking

- Add `masteryUsedThisTurn?: Record<string, boolean>` to combatant resources
- Track Cleave and Nick usage (both are once-per-turn)
- Reset in `extractActionEconomy()` at turn start

### Step 4: Weapon Data

- Add `mastery` field to weapon definitions in equipment import
- Map standard weapons to their mastery properties:
  - Greatsword → Graze, Longsword → Sap, Rapier → Vex, etc.
- Update `WeaponSpec` construction in character sheet parsing

### Step 5: E2E Scenarios (1-2 days)

- `mastery/graze.json` — Greatsword miss → ability mod damage
- `mastery/push.json` — Warhammer hit → push 10ft
- `mastery/topple.json` — Maul hit → CON save → Prone
- `mastery/vex.json` — Rapier hit → Advantage on next attack
- `mastery/sap.json` — Morningstar hit → Disadvantage on target's next attack
- `mastery/slow.json` — Halberd hit → -10ft speed
- `mastery/cleave.json` — Greataxe hit → free attack on adjacent creature
- `mastery/nick.json` — Scimitar + Nick → extra attack as part of Attack action

## Dependencies

- Hit-Rider Enhancement Pipeline (System 2) — can reuse for on-hit effects
- SavingThrowResolver — for Topple's CON save
- Condition system — for Prone (Topple), Disadvantage (Sap), Advantage (Vex)
- Movement system — for Slow speed reduction, Push displacement

## Complexity Assessment

- **Total effort**: 4-6 days
- **Most complex**: Cleave (secondary attack flow) and Nick (action economy modification)
- **Simplest**: Graze (damage on miss), Push/Topple (reuse existing infrastructure)
- **Risk**: Cleave creates a secondary attack which may need its own pending action chain
- **Recommendation**: Start with Graze + Push + Topple + Vex (simple, reuse existing systems), then Sap + Slow (condition-based), then Cleave + Nick (most complex)

## Implementation Notes (Completed)

### Phase 1: Completed — 6 of 8 Mastery Properties

**Date**: Implemented in Phase 6.6

**What was done:**

1. **Domain types** (`domain/rules/weapon-mastery.ts`):
   - `WeaponMasteryProperty` type union for all 8 mastery keywords
   - `WEAPON_MASTERY_MAP` — standard weapon → mastery mapping for all D&D 5e 2024 weapons
   - `resolveWeaponMastery()` — resolves effective mastery for a weapon in a character's hands
   - `hasWeaponMasteryFeature()` — class-based check (Fighter, Barbarian, Paladin, Ranger, Rogue)
   - `hasWeaponMastery()` — character-level check with explicit `weaponMasteries[]` support + auto-grant fallback

2. **WeaponSpec extended** (`tabletop-types.ts`):
   - Added `mastery?: WeaponMasteryProperty` field
   - Populated in `action-dispatcher.ts` WeaponSpec construction via `resolveWeaponMastery()`
   - Also wired into `offhand-attack-executor.ts` for two-weapon fighting

3. **New conditions** (`conditions.ts`):
   - `Sapped` — disadvantage on next attack roll (used by Sap mastery)
   - `Slowed` — speed reduced by 10ft (used by Slow mastery)
   - Both conditions have `getConditionEffects()` entries

4. **Turn-scoped tracking** (`resource-utils.ts`):
   - Added `cleaveUsedThisTurn`, `nickUsedThisTurn`, `vexTargetId`, `vexSourceId` to `resetTurnResources()`

5. **Mastery effects in combat** (`roll-state-machine.ts`):
   - **Graze**: On miss (non-critical), deals ability modifier damage. Applied in `handleAttackRoll()` miss path.
   - **Push**: On hit, STR save (DC 8 + ability mod + prof) or pushed 10ft. Uses `SavingThrowResolver`.
   - **Topple**: On hit, CON save (DC 8 + ability mod + prof) or knocked Prone. Uses `SavingThrowResolver`.
   - **Vex**: On hit, stores `vexTargetId`/`vexSourceId` in attacker resources. Consumed in `action-dispatcher.ts` for advantage on next attack vs same target.
   - **Sap**: On hit, applies `Sapped` condition to target (until start of attacker's next turn).
   - **Slow**: On hit, applies `Slowed` condition to target (until start of attacker's next turn).
   - All effects display in damage message (e.g., " Topple: Goblin knocked Prone (CON 13 vs DC 15)!")

6. **E2E test scenarios** (6 scenarios in `scripts/test-harness/scenarios/mastery/`):
   - `graze-mastery.json` — Greatsword miss → 4 STR damage
   - `push-mastery.json` — Warhammer hit → STR save or pushed 10ft
   - `topple-mastery.json` — Maul hit → CON save or Prone
   - `vex-mastery.json` — Rapier hit → advantage on next attack vs same target (verified consumed)
   - `sap-mastery.json` — Longsword hit → Sapped condition on target
   - `slow-mastery.json` — Longbow hit → Slowed condition on target

**Test results**: 81 E2E scenarios passed (including 6 new mastery scenarios), 458 unit tests passed, typecheck clean.

### Phase 2: Completed — Cleave & Nick ✅

**Cleave** (secondary attack) — Implemented in Phase 6.6.1:
- Auto-resolved secondary attack in `resolveWeaponMastery()` "cleave" case (~100 lines)
- Finds secondary targets within 5ft of hit target AND within attacker's reach via `calculateDistance()`
- Uses `diceRoller.d20()` + weapon attack bonus for secondary attack roll
- Rolls weapon damage dice WITHOUT ability modifier (adds only if negative)
- Handles critical hits (doubles dice) on secondary attack
- Tracks `cleaveUsedThisTurn` in combatant resources
- E2E scenario: `mastery/cleave-mastery.json` — Fighter with Greataxe vs two Goblins in tight cluster

**Nick** (extra attack as part of Attack action) — Implemented in Phase 6.6.2:
- Detection in `ActionDispatcher.dispatch()`: checks offhand weapon for Nick mastery before routing to `handleBonusAbility()`
- Added `skipBonusActionCost` parameter to `handleBonusAbility()` — skips both the availability check and the `useBonusAction()` resource consumption
- Tracks `nickUsedThisTurn` in combatant resources (second use in same turn costs bonus action normally)
- `bonusActionUsed` flag is conditional: only set when bonus action was actually consumed
- E2E scenario: `mastery/nick-mastery.json` — Fighter with Shortsword + Scimitar (Nick), off-hand attack then Second Wind (proving bonus action preserved)

**All 8/8 weapon mastery properties now implemented.** Final test run: 83 E2E, 458 unit, typecheck clean.

### Design Decisions

1. **Mastery effects are AUTOMATIC** — they are NOT routed through the HitRiderEnhancement opt-in keyword pipeline. Instead, they're applied directly in `resolveWeaponMastery()` after damage resolution.
2. **Finesse weapons** use `max(STR, DEX)` for mastery save DCs, consistent with how finesse weapons work for attacks.
3. **Graze doesn't trigger on critical misses** (natural 1) — this is a design choice to keep critical miss as a clear "whiff".
4. **Auto-grant mastery** — until explicit weapon mastery selection UI is implemented, characters from mastery-granting classes automatically have mastery with all their weapons. The `weaponMasteries[]` sheet array is supported for explicit control.
5. **Condition expiry** — Sapped and Slowed use `until_start_of_next_turn` duration with explicit `expiresAt` targeting the attacker's next turn start.
