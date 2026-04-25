---
type: plan
flow: ClassAbilities,ReactionSystem
feature: small-feature-cleanup
author: claude-orchestrator
status: DRAFT
created: 2026-04-24
updated: 2026-04-24
---

# Plan: Small Feature Cleanup (Cunning Strike, Slow Fall, Tactical Mind)

## 1. Cunning Strike (Rogue L5)

After SA hit: forfeit SA dice for effect. Options: Disarm (1d), Poison (1d), Trip (1d, Large or smaller), Withdraw (1d, move 15ft no OA), Daze (2d, CON save or no Reaction + only Action/BA).

**Exists**: `parseCunningStrikeOption`, `CunningStrikeOption`, `rogueCunningStrikeSaveDC` in `rogue.ts`. No executor.

**Steps**: parse option from player text at L5+ SA hit → store on pending damage → after damage, call `applyCunningStrikeEffect(targetId, option, savePipeline)` → reduce SA dice before damage.

**Files**: `damage-resolver.ts`, new `cunning-strike-resolver.ts`, `rogue.ts` text profile.

**Scope**: ~0.5 day. ~150 LOC.

## 2. Slow Fall (Monk L4)

On fall: reaction reduces fall damage by 5 × Monk level.

**Exists**: `pit-terrain-resolver.ts` handles fall. No fall-damage reaction hook.

**Steps**:
1. Extend `damage-reaction-handler.ts` to emit fall-damage-reaction `PendingAction`
2. In `pit-terrain-resolver.ts`: before fall damage, check Monk L4+ with reaction available → create pending action
3. `SlowFallExecutor` — consumes reaction, reduces damage by 5 × level
4. Apply modified amount

**Files**: `pit-terrain-resolver.ts`, `domain/entities/combat/pending-action.ts` (add fall-damage trigger), `damage-reaction-handler.ts`, new `monk/slow-fall-executor.ts`.

**Scope**: ~1 day. ~250 LOC. Also adds generic fall-damage-reaction for Feather Fall etc.

## 3. Tactical Mind (Fighter L2)

After failed ability check: spend one Second Wind use (no heal) to reroll. Take higher.

**Blocked on plan-d20-roll-interrupt.md.**

Once d20-interrupt lands: add `TacticalMindOption` to interrupt option list for Fighter L2+ with Second Wind remaining on failed ability check. Reroll d20, take higher, decrement pool.

**Scope**: ~0.25 day AFTER d20 interrupt lands.

## Ship strategy
Cunning Strike + Slow Fall independent → ship before d20 interrupt. Tactical Mind after.
