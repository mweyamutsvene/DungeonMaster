---
type: sme-feedback
flow: CombatRules
feature: classabilities-row-staleness-2026-04-26
author: CombatRules-SME
status: IN_REVIEW
round: 2
created: 2026-04-26
updated: 2026-04-26
---

## Verdict
NEEDS_WORK

## Findings
1. Bard roll-interrupt caveat is accurate. Current roll-interrupt wiring supports Bardic Inspiration on attack/save interrupts, while ability-check interrupt parity is still not present in the same path.
2. Bard Cutting Words caveat is accurate. Attack-reaction handling includes a Cutting Words subtraction path for attack rolls, but broader trigger parity (ability-check and damage-roll variants) is not represented in the runtime attack reaction flow.
3. Monk Slow Fall caveat is accurate. Slow Fall is implemented as auto-apply fall-damage reduction when reaction is available, with reaction consumption handled in movement/shove pit-resolution paths, and no dedicated reaction prompt flow.
4. Paladin Divine Sense caveat is not accurate as written. The plan text frames Divine Sense as "mis-modeled under L3 Channel Divinity flow," but current repository 2024 rules content and class wiring both place Divine Sense under Paladin Channel Divinity at L3.

## Required Fixes
1. Remove or rewrite the Paladin caveat text that claims Divine Sense is "mis-modeled under L3 Channel Divinity flow." As currently implemented, that L3 Channel Divinity placement aligns with repository 2024 Paladin rules text.
2. Reconcile the Paladin row wording with the corrected caveat so the row does not assert L1 Divine Sense MISSING based on an incorrect modeling assumption.

## Optional Improvements
1. Add one sentence in the plan clarifying that this row update follows the repository's 2024 Paladin source text for Divine Sense/Channel Divinity placement, to prevent repeated review churn.
2. For Bard, keep the current caveat but include a short parenthetical naming the deferred non-attack triggers (ability-check and damage-roll) for unambiguous scope control.
