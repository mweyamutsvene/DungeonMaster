---
type: sme-feedback
flow: ClassAbilities
feature: classabilities-row-staleness-2026-04-26
author: ClassAbilities-SME
status: IN_REVIEW
round: 2
created: 2026-04-26
updated: 2026-04-26
---

## Verdict
APPROVED

## Findings
1. Prior blocker on Paladin L3 subclass status is addressed in the plan row replacement. The Paladin target now marks Sacred Oath as PARTIAL and explicitly calls out Oath of Devotion Sacred Weapon as implemented.
2. Prior blocker on exact row replacement control is addressed. The plan now provides concrete before/after row strings across the class table updates (with Druid handled as an explicit no-op target), which removes prior wording-drift risk.
3. Paladin row text is now aligned with live runtime wiring (Sacred Weapon executor present and registered), not the earlier stale assumption.

## Required Fixes
None.

## Optional Improvements
1. Update plans/sme-research-ClassAbilities-row-paladin.md (or add an explicit superseded note in the plan) because it still states Sacred Oath MISSING and no Sacred Weapon executor, which can confuse future reviewers.
2. Consider setting the plan status/round metadata to reflect the post-fix re-review state for traceability.
