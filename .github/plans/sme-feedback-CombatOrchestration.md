VERDICT: APPROVED

# SME Feedback — CombatOrchestration — Phase 3.1 Fighting Styles — Round 1

## Summary
The two CombatOrchestration-flow changes (GWF fix in tabletop `damage-resolver.ts`; Dueling offhand check in `feat-modifiers.ts`) are correctly scoped, correctly placed, and low-risk. No issues with the pending-action state machine, Extra Attack chain, or existing damage-reaction pipeline. Implementation notes below are non-blocking.

## Validation

### (a) GWF tabletop fix location — CORRECT
- `application/services/combat/tabletop/rolls/damage-resolver.ts` is the right site. The AI path (`domain/combat/attack-resolver.ts`) is the reference; tabletop flow indeed skips GWF today.
- "Apply `applyDamageDieMinimum` to the raw damage roll BEFORE modifiers" matches 2024 RAW (GWF rerolls 1s/2s once = effective die minimum of 3) and mirrors the AI-side pipeline.
- Gating via `fightingStyle` on the attacker sheet + `shouldApplyGreatWeaponFighting({ attackKind, weapon })` is the same predicate used on the AI side — consistent and correct.

### (b) Regression risk — Extra Attack chain & existing damage reactions — LOW
- **Extra Attack chain**: chains are triggered post-damage by `damage-resolver`'s tail logic (`canMakeAttack()` → new ATTACK pending action; rollType `'attack'`). GWF only mutates the dice sum on the CURRENT strike; it does not touch the chain decision, rollType, or scenario-runner auto-complete. Safe.
- **Damage reactions (Hellish Rebuke, Absorb Elements)**: `tryInitiateDamageReaction` in `session-tabletop.ts` fires POST-HP-write when resolving a DAMAGE pending action. GWF changes the damage number, not the sequence/ordering of pending actions or events. Reaction pipeline timing is untouched. Safe.
- **Deflect Attacks / Uncanny Dodge / Cutting Words**: applied in `AttackReactionHandler.complete()` against `damageApplied` AFTER the damage-resolver returns. Post-GWF damage flows through the same reduction sites without change.
- **Pre-existing caveat (NOT caused by this plan)**: damage reactions don't fire on Extra-Attack-chained damage steps because the queued ATTACK pending action blocks the `damageReaction` guard. Flagged for awareness only — unrelated to Phase 3.1.

### (c) Dueling offhand check — LOW REGRESSION RISK
- Existing Dueling scenarios (e.g., `tank-vs-resistance.json`) equip a one-hander + shield, not a one-hander + offhand weapon. The new gate rejects only the two-weapon configuration, which was already RAW-incorrect for Dueling. No existing scenario should regress.
- Implementation note: the "offhand weapon equipped" check should read the attacker's combatant/resources, not parse the sheet inline in `shouldApplyDueling`. Prefer a `hasOffhandWeapon` boolean surfaced through feat-mod inputs so `feat-modifiers.ts` stays a pure function. This also keeps it live if equipment changes mid-combat.

## Implementation Notes (non-blocking)
1. **Dice ordering**: in `damage-resolver.ts`, apply die-minimum to the RAW per-die array from the dice roller (before summing) so per-die visibility is preserved in event payloads and crit double-dice math stays correct.
2. **Event enrichment**: consider adding a `featsApplied` / `gwfAdjusted` breadcrumb to `AttackResolved` or `DamageApplied` payloads (parallels recent `attackBonus`/`targetAC` enrichment). Nice-to-have, not required.
3. **Dueling regression guard**: in `feat-modifiers.dueling.test.ts`, add a case asserting Dueling STILL applies with shield-only + no offhand weapon, alongside the new "offhand blocks Dueling" case.

## Cross-flow deferrals
- Ally-scan reaction pipeline → defer to ReactionSystem-SME.
- Fighting-style flag population on combat resources → defer to CreatureHydration-SME.
- `ClassCombatTextProfile.allyAttackReactions` extension → defer to ClassAbilities-SME.
