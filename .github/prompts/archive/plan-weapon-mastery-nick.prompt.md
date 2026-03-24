# Plan: Weapon Mastery — Nick (Phase 6.6.2) ✅ COMPLETED

## Overview

Implement the **Nick** weapon mastery property from D&D 5e 2024. ~~Currently stubbed as a TODO in `roll-state-machine.ts`.~~

## D&D 5e 2024 Rule

**Nick**: When you make the extra attack of the Light property, you can make it as part of the Attack action instead of as a Bonus Action. You can make this extra attack only once per turn.

In other words, if wielding two Light weapons and the offhand weapon has Nick mastery, the offhand attack doesn't consume the bonus action.

## Implementation Approach

1. In `OffhandAttackExecutor.execute()`:
   - Check if the offhand weapon has Nick mastery
   - If so, skip the bonus action consumption (don't call `useBonusAction()`)
   - Track `nickUsedThisTurn` in resources (already wired in resetTurnResources)

2. In `handleBonusAbility()` or `ActionDispatcher`:
   - When processing offhand attack with Nick, don't mark as bonus action
   - Allow the player to still use their bonus action for something else

3. Create E2E scenario `mastery/nick-mastery.json` showing:
   - Attack with main hand weapon
   - Off-hand attack with Nick weapon (doesn't cost bonus action)
   - Bonus action still available for another ability

## Complexity

Medium — needs modification to offhand attack action economy, plus once-per-turn tracking.

## Implementation Notes (Completed)

### Changes Made
- **`action-dispatcher.ts`** — Three changes:
  1. In `dispatch()`: When `directOffhand` is detected, checks if the offhand weapon (2nd weapon in attacks array) has Nick mastery via `resolveWeaponMastery()`. If Nick + not yet used this turn → sets `skipBonusCost = true`.
  2. `handleBonusAbility()`: Added `skipBonusActionCost = false` parameter. When true: skips bonus action availability check, doesn't consume bonus action, instead marks `nickUsedThisTurn: true`.
  3. In the executor resources merge block: `bonusActionUsed: true` is now conditional on `!skipBonusActionCost` to prevent overriding the Nick skip.
- **`mastery/nick-mastery.json`** — E2E scenario: Fighter with Shortsword (main) + Scimitar (offhand, Nick). Performs main attack → offhand attack (no bonus action cost) → Second Wind (bonus action still available). Asserts character HP increased.

### Key Design Decisions
- Nick detection happens at the `dispatch()` level, not in the executor — this keeps the `OffhandAttackExecutor` unchanged and puts the action economy decision where it belongs (routing layer)
- The offhand attack pending action still has `bonusAction: "offhand-attack"` label for identification — only the resource consumption is skipped
- `nickUsedThisTurn` is tracked in combatant resources (reset per turn via `resetTurnResources()`)
- Second use in same turn falls back to normal bonus action consumption

### Test Results
- 83 E2E scenarios passed (including nick-mastery), 458 unit tests passed, typecheck clean
