VERDICT: APPROVED

As you wish Papi....

# SME Feedback — ClassAbilities — Round 1

## Summary
Plan correctly addresses every ClassAbilities gap from `sme-research-ClassAbilities.md`:
- New `allyAttackReactions` field + `detectAllyAttackReactions` helper on `ClassCombatTextProfile` is cleaner than overloading `detect()` with a target-vs-ally mode param. Scales for future Cavalier/Battle Master reactions.
- Moving `PROTECTION_REACTION`/`INTERCEPTION_REACTION` out of `attackReactions` into `allyAttackReactions` is correct — those defs were dead code in the target-scan path.
- Populating `hasProtectionStyle` / `hasInterceptionStyle` / `hasShieldEquipped` / `hasWeaponEquipped` in `combat-resource-builder.ts` wires the stub flags my research flagged as never-written.
- Two-pattern discipline preserved: domain declares reactions in `fighter.ts`; application consumes via collector in `registry.ts`. No class-specific logic leaks into services.
- AbilityRegistry untouched (correct — these are reactions, not executors; `app.ts` registration unaffected).

## Minor Issues (non-blocking)

1. **Inaccurate reference in plan.** `registry.ts` has no `getAllAttackReactions` collector today — only `getAllCombatTextProfiles()`. Plan says "parallel to existing `getAllAttackReactions`".
   - Fix: either (a) add `getAllAllyAttackReactions()` that flattens `getAllCombatTextProfiles().flatMap(p => p.allyAttackReactions ?? [])`, or (b) have the ReactionSystem caller use `getAllCombatTextProfiles()` directly and pass the profiles to `detectAllyAttackReactions` (matches how target-scan consumes profiles today). Option (b) is lighter and more consistent with current pattern — recommend.

2. **Resource-flag placement tradeoff acknowledged but deserves an explicit follow-up.** My research preferred per-attack computation in the reaction dispatcher so equipment swaps mid-combat are picked up instantly. Plan puts flags in `combat-resource-builder.ts` (hydration-time) and notes the staleness risk in Risks. Acceptable for Phase 3.1, but:
   - Fix: add a `- [ ]` follow-up TODO line in the plan under Risks calling out "re-hydrate flags on equip/unequip events" so it isn't lost.

3. **`combat-text-profile.ts` unit test coverage.** Plan lists a unit test for `detectAllyAttackReactions`. Ensure the test also asserts that Protection/Interception are **not** returned by `detectAttackReactions` (target-scan) after the move — prevents accidental double-fire if someone re-adds them to `attackReactions` later.

## Cross-Flow Gaps Affecting ClassAbilities Scope

- **Sentinel inconsistency:** plan leaves Sentinel's ally-scan as a bespoke loop in `AttackReactionHandler.initiate()` rather than migrating it onto `allyAttackReactions`. Sentinel's trigger (move-away-from-ally) differs from Protection's (attack-against-ally), so the shapes don't unify cleanly — acceptable, but ReactionSystem SME should confirm no future consolidation is planned that would require reshaping `AttackReactionDef` again.

- **Gap 4 (AI NPC ally fighting styles) intentionally deferred** — plan does not address AI-controlled NPC allies with `archery`/`dueling`. Matches my research recommendation. No action needed for 3.1.

## Approval
Approved to proceed. Address Issue #1 (collector naming) during implementation; Issues #2 and #3 are follow-ups that do not block.
