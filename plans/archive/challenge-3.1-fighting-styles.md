---
type: challenge
flow: ClassAbilities
feature: 3.1-fighting-styles
author: copilot-developer
status: COMPLETE
round: 1
created: 2026-04-15
updated: 2026-04-15
---

# Plan Challenge — 3.1 Fighting Styles

## Overall Assessment: WEAK — multiple RAW errors and unresolved design gaps

## Critical Issues (must address before implementation)

1. **Reroll-and-take-min is NOT equivalent to disadvantage when advantage is present.**
   SME research (ReactionSystem §Q1 / CombatOrchestration) claims rolling a 3rd d20 and taking min-of-3 when attacker has advantage is "2024 RAW for cancelling advantage + adding disadvantage." This is **wrong**. 2024 PHB: *any* source of advantage + *any* source of disadvantage cancel to **one straight d20**. Not min-of-{d20a, d20b, d20c}. Elven Accuracy (3 dice take high) also collapses to straight. Plan's Risks section asserts equivalence with no caveat. Fix: inspect stored `rollMode`; if advantage or disadvantage already present, recompute as a single fresh d20 (no min). Without this, PCs with Elven Accuracy + imposed Protection are mathematically penalized.

2. **Opportunity attacks bypass the new ally-scan entirely.**
   Plan adds ally-scan only to `AttackReactionHandler.initiate()`. OAs come from `MoveReactionHandler` (see `combat/two-phase/` structure). Plan does not state whether OAs route through `AttackReactionHandler.initiate()` or not. If they don't, Protection/Interception never fire on OAs — a RAW gap (2024 explicitly says "any attack," including OAs). Verify the code path; if OAs don't flow through `initiate()`, the ally-scan must be mirrored in the move-reaction path or lifted to a shared helper.

3. **GWF tabletop fix is under-specified; SME flagged it as schema-level.**
   SME Research (ClassAbilities Gap 2) warned: tabletop `RollResultCommand.value` is a player-submitted *total*, not raw dice. Plan says "apply `applyDamageDieMinimum` to the raw damage roll BEFORE modifiers" — but the code has no raw dice to apply it to. SME listed three mutually exclusive resolutions (transmit raw dice / server reroll / reconstruct from die count). Plan picks none. This is not an implementation-ready bullet.

4. **`PendingAttackData` schema extension is not in the plan.**
   SME ReactionSystem §7 explicitly calls for extending `PendingAttackData` with `d20Roll`, `attackBonus`, `rollMode` (not just "likely already present"). Plan's file list does not include `pending-action.ts`. Without `d20Roll` stored, Protection cannot reroll the underlying die; without `rollMode`, the adv/disadv collapse logic in Issue #1 has nothing to read. Add the schema change as a concrete bullet.

5. **Incapacitated / unconscious / prone protectors not gated.**
   `canUseProtection()` checks style + shield + reaction + distance only. It does NOT check conditions. RAW: incapacitated creatures cannot take reactions. Plan's ally-scan loop description (`within 5ft AND has reaction`) uses `hasReaction` flag — but that flag only tracks "reactionUsed," not the Incapacitated/Stunned/Unconscious/Paralyzed conditions. Add condition check in loop or in `canUseProtection/Interception` signatures.

6. **Protection vs Shield ordering is asserted by SME but not codified in plan.**
   SME Risk #6: "Protection reroll first → Shield AC adjustment → hit check." Plan's `complete()` description lists reaction handling as unordered branches. If Shield runs first and boosts AC, then Protection reroll is evaluated against the already-boosted AC — fine. If Protection reroll lowers the attack below pre-Shield AC, Shield is wasted — but target chose to spend it. Need explicit ordering spec in `complete()` step; otherwise implementers will guess.

## Concerns (should address, but not blocking)

1. **Interception → damage=0 → downstream trigger suppression.** If Interception reduces damage to 0, no damage event fires — correctly skipping Hellish Rebuke/concentration-save/unconscious-trigger/temp-HP-on-damage. Plan doesn't enumerate this; add an explicit assertion step to the E2E to prove the suppression.

2. **Multiple simultaneous protectors.** Two allies adjacent to target, both with Protection + reaction available. Plan is silent on UX/ordering.

3. **`hasWeaponEquipped` computation is ambiguous.** Use `extractEquipment` shape from `creature-hydration.ts`.

4. **Stale-equipment risk understated.** Scenario proposes mid-round style switch — not a legal mid-combat action. Should be two separate scenarios.

5. **Dueling "no offhand" — callers must pass offhand state.** Plan extends `shouldApplyDueling` signature but lists no caller updates (`attack-resolver.ts:233`, `damage-resolver.ts:169`).

6. **AI-controlled NPC ally with Protection.** Plan should explicitly list "auto-decline for AI protectors v1" as a TODO.

## Edge Cases NOT Covered by Test Plan

1. Protector took an OA themselves → cannot also use Protection (already reacted).
2. Protector has advantage/disadvantage flags that change the collapse math.
3. AOE / eldritch blast per-beam (RAW: yes, each beam is a separate attack).
4. Attacker has Advantage from Pack Tactics + Protection imposed → should be straight roll.
5. Lucky reroll timing ordering.
6. Protector is the target / protector is the attacker — unit-test these edge cases.
7. Interception after Uncanny Dodge halving — operation order.
8. Unconscious ally targeted (auto-crit from melee).
9. Ranged attack from 60ft — distance measured protector↔target.
