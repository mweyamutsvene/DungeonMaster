# SME Feedback — CombatOrchestration — Round 2
## Verdict: APPROVED

## Verification of requested items

### 1. GWF deferral — CONFIRMED
`## Deferred` section explicitly lists "GWF in tabletop: requires `RollResultCommand` schema change or server reroll. Deferred to dedicated plan." Objective line also flags it. No longer a hidden risk; scope is clean for 3.1.

### 2. Dueling offhand caller updates — CONFIRMED
Both callers listed under CombatOrchestration flow:
- `domain/combat/attack-resolver.ts` — "Update `shouldApplyDueling` caller to pass `offhandWeaponEquipped`"
- `application/services/combat/tabletop/rolls/damage-resolver.ts` — "Update `shouldApplyDueling` caller similarly"
- Plus `domain/rules/feat-modifiers.ts` signature extension.
Covers both attack-roll and damage-roll paths. Unit test `feat-modifiers.dueling.offhand.test.ts` gates the contract.

### 3. Resolution ordering — SAFE
Ordering: Protection → Shield → hit → damage → Deflect → Interception → UncannyDodge → apply.

- **Extra Attack chain**: chaining is driven by `canMakeAttack()` in damage-resolver post-apply. Interception reducing damage to 0 does NOT block the chain (chain is not damage-gated). No regression.
- **Hellish Rebuke / damage reactions**: fire on damage applied to target. If Interception reduces to 0, the target took no damage — skipping Hellish Rebuke is **correct 5e 2024 behavior** ("when you take damage"). Plan's "Zero-damage suppresses downstream triggers via existing `if (damage > 0)` guards" is accurate. Pre-existing EA-chain/damage-reaction interaction (stored repo memory) is orthogonal and not worsened.
- **Concentration save**: `onDamageTaken` is gated by `damage > 0`. Interception-to-zero correctly suppresses the save (target took no damage). Matches 5e RAW. Explicitly covered by `interception-reaction.json` bonus assertion.
- **Protection before Shield**: correct — Protection modifies the attack roll; Shield modifies AC. Attack total must be finalized before AC compare. Order preserves existing Shield semantics.
- **Deflect before Interception**: both are damage reductions; target's own reaction resolves before ally reaction. Floor-0 on each prevents negative cascade. Acceptable.

## Additional notes (non-blocking)
- Plan correctly defers OA ally-scan; `MoveReactionHandler → AttackReactionHandler` integration is a known boundary. Documented in Deferred.
- `originalRollMode` preservation on `PendingAttackData` is the right hook for Protection math; verify the adv→straight-d20 path emits a fresh `rollRequest` through the existing rollMode prompt helper (not a dual-value submission — see repo memory on single-value rolls).

No blockers. Clear to proceed to implementation.
