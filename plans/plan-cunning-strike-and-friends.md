---
type: plan
flow: ClassAbilities,ReactionSystem
feature: small-feature-cleanup
author: claude-orchestrator
status: DRAFT
created: 2026-04-24
updated: 2026-04-24
---

# Plan: Smaller Class Feature Cleanup (Cunning Strike, Slow Fall, Tactical Mind)

Three smaller features that share the property of "needs an existing-system extension rather than a new system."

## 1. Cunning Strike (Rogue L5, 2024)

**RAW**: When you deal Sneak Attack damage, you may forgo some Sneak Attack dice to inflict an additional effect:
- **Disarm** (1 SA die): target makes DEX save vs DC = 8 + DEX mod + PB; on fail, drops one held item.
- **Poison** (1 SA die): target makes CON save; on fail, Poisoned for 1 minute (save end of each turn).
- **Trip** (1 SA die): target makes DEX save; on fail, Prone (only if creature is Large or smaller).
- **Withdraw** (1 SA die): no save; you can move 15 ft without provoking opportunity attacks.
- **Daze** (2 SA dice): CON save; on fail, can't take a Reaction and only Action OR Bonus Action on next turn.

**Current state**: `parseCunningStrikeOption`, `CunningStrikeOption`, `rogueCunningStrikeSaveDC` exist in `rogue.ts`. Damage-resolver tracks `cunningStrike` flag. No executor or post-hit prompt.

**Plan**:
1. After a Sneak-Attack-eligible hit at L5+, check if player text mentioned a Cunning Strike option (e.g., "with cunning trip").
2. If so, parseCunningStrikeOption and store on the pending damage roll.
3. After damage applied, route to `applyCunningStrikeEffect(targetId, option, savePipeline)`.
4. Reduce sneak attack dice by N before applying damage.

**Touched**: `damage-resolver.ts`, new `cunning-strike-resolver.ts` helper, `rogue.ts` text profile for the keyword.

**Scope**: ~0.5 day. ~150 LOC.

## 2. Slow Fall (Monk L4)

**RAW**: When you fall, you can use your reaction to reduce fall damage by 5 × Monk level.

**Current state**: Fall damage works via `pit-terrain-resolver.ts`. No reaction-trigger emits a "you are about to take fall damage" pending action. Slow Fall is unimplemented.

**Plan**:
1. Extend `damage-reaction-handler.ts` to emit a fall-damage-reaction PendingAction kind.
2. In `pit-terrain-resolver.ts`, before applying fall damage, check if the falling creature is a Monk L4+ with reaction available; if so, create the pending action.
3. Add `SlowFallExecutor` that consumes the reaction and reduces damage by 5 × level.
4. Resolve damage with the modified amount.

**Touched**: `pit-terrain-resolver.ts`, `domain/entities/combat/pending-action.ts` (add fall-damage trigger), `damage-reaction-handler.ts`, new `monk/slow-fall-executor.ts`.

**Scope**: ~1 day. ~250 LOC. Note: this also adds a generic fall-damage-reaction kind that future features can subscribe to (Feather Fall spell, Catfall, etc.).

## 3. Tactical Mind (Fighter L2 2024)

**RAW**: After you fail an ability check, you can spend one Second Wind use (without taking the Second Wind action's heal) to reroll the check. Take the higher result.

**Current state**: feature-key + features-map entry added. **Blocked on the d20 roll-interrupt hook** (see plan-d20-roll-interrupt.md).

**Plan**: Once d20 roll-interrupt lands, add a `TacticalMindOption` to the interrupt option list when the actor is Fighter L2+ with Second Wind uses remaining and the rolled d20 was an ability check that failed. Selecting it: reroll d20, take higher, decrement Second Wind pool.

**Scope**: ~0.25 day **after** d20 interrupt lands. Pure layering on top of that infrastructure.

## Combined commit strategy

Three small wins; ship as one PR after the d20 interrupt hook lands (Tactical Mind needs that). Cunning Strike and Slow Fall can ship before that — they're independent.
