---
type: sme-feedback
flow: CombatRules
feature: classabilities-row-staleness-2026-04-26
author: CombatRules-SME
status: IN_REVIEW
round: 1
created: 2026-04-26
updated: 2026-04-26
---

## Verdict
NEEDS_WORK

## Findings
1. Bard caveat is too vague for reaction/interrupt correctness. The plan says "attack-reaction caveat" but does not lock the exact scope: Cutting Words is currently wired in attack-reaction flow only, while roll-interrupt parity for non-attack triggers remains incomplete.
2. Bard roll-interrupt scope needs explicit guardrail text. Bardic Inspiration consumption is wired for attack/save interrupts, not ability-check interrupts in current roll-interrupt plumbing; the plan should prevent wording that implies full interrupt coverage.
3. Monk reaction mechanics need one explicit caveat. Deflect Attacks is reaction-wired, but Slow Fall remains auto-apply without a reaction prompt; if Monk row wording says "SUP" without qualifier, it risks overclaiming RAW reaction behavior.
4. Paladin L1/L3 movement is directionally correct, but cross-flow caveat should be explicit: Divine Sense is marked MISSING at L1 while current runtime behavior is tied to Channel Divinity flow at L3. Without this note, reviewers may misread the row delta as pure documentation-only drift.

## Required Fixes
1. Update the Bard replacement text in the plan to explicitly state: Cutting Words is attack-reaction implemented; broader trigger parity (ability-check/damage-roll variants) is deferred.
2. Add explicit Bard wording that roll-interrupt support is attack/save scoped today (not ability-check parity).
3. Add a Monk wording note that Slow Fall is supported with auto-apply behavior and no reaction prompt yet (or downgrade claim accordingly).
4. Add a Paladin caveat note that Divine Sense is currently mis-modeled under Channel Divinity flow, justifying L1 MISSING + L3 Channel Divinity PARTIAL wording.

## Optional Improvements
1. Include exact final markdown row strings for Bard/Monk/Rogue/Paladin in this plan so SME review can validate wording-level correctness before edits land.
2. Add one sentence in the plan risk section distinguishing "documentation status correction" from "known runtime mechanics gaps" for these four rows.
