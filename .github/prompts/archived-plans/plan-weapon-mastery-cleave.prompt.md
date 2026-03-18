# Plan: Weapon Mastery — Cleave (Phase 6.6.1) ✅ COMPLETED

## Overview

Implement the **Cleave** weapon mastery property from D&D 5e 2024. ~~Currently stubbed as a TODO in `roll-state-machine.ts`.~~

## D&D 5e 2024 Rule

**Cleave**: If you hit a creature with a melee attack roll using this weapon, you can make a melee attack roll with the weapon against a second creature within 5 feet of the first that is also within your reach. On a hit, the second creature takes the weapon's damage, but don't add your ability modifier to that damage unless that modifier is negative. You can make this extra attack only once per turn.

## Implementation Approach

1. In `resolveWeaponMastery()` case "cleave":
   - Find adjacent creatures (within 5ft of the hit target, within attacker's reach)
   - If none found, return empty string
   - If found, auto-resolve the secondary attack:
     - Use `diceRoller.d20()` for attack roll
     - Apply same attack bonus as original weapon
     - On hit, roll weapon damage dice WITHOUT ability modifier
   - Track `cleaveUsedThisTurn` in resources (already wired in resetTurnResources)

2. Create E2E scenario `mastery/cleave-mastery.json` with multiple monsters in melee range

## Complexity

Medium — needs auto-resolved secondary attack with dice roller + target selection + once-per-turn tracking.

## Implementation Notes (Completed)

### Changes Made
- **`roll-state-machine.ts`** — Replaced the TODO stub in the `"cleave"` case of `resolveWeaponMastery()` with ~100 lines of logic:
  - Checks `cleaveUsedThisTurn` once-per-turn limit from combatant resources
  - Finds secondary targets within 5ft of hit target AND within attacker's reach using `calculateDistance()` and `getPosition()`
  - Auto-rolls attack with `diceRoller.d20()` + same attack bonus
  - On hit, rolls weapon damage dice WITHOUT ability modifier (only adds modifier if negative)
  - Handles critical hits (doubles dice)
  - Applies damage to secondary target
  - Marks `cleaveUsedThisTurn: true` in resources
- **`mastery/cleave-mastery.json`** — E2E scenario with Fighter (Greataxe) vs two Goblins in tight cluster (positions ≤5ft apart using non-standard grid to ensure all pairwise distances ≤5ft)

### Key Design Decisions
- Auto-resolved secondary attack (not a new pending action) — matches Graze approach where the server fully resolves the effect
- Critical misses on the secondary attack don't affect anything (no special handling)
- First eligible secondary target is chosen automatically (no player choice)
- Position constraint: Euclidean distance ≤5ft for BOTH "within 5ft of target" and "within your reach" checks

### Test Results
- 83 E2E scenarios passed (including cleave-mastery), 458 unit tests passed, typecheck clean
