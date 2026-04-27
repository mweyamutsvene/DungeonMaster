---
type: sme-feedback
flow: ClassAbilities
feature: classabilities-row-staleness-2026-04-26
author: ClassAbilities-SME
status: IN_REVIEW
round: 1
created: 2026-04-26
updated: 2026-04-26
---

## Verdict
NEEDS_WORK

## Findings
1. Paladin L3 subclass status is inaccurate/incomplete in the plan. Current runtime has Oath of Devotion Sacred Weapon implemented and registered (`packages/game-server/src/application/services/combat/abilities/executors/paladin/sacred-weapon-executor.ts`, `packages/game-server/src/infrastructure/api/app.ts`, `packages/game-server/src/domain/entities/classes/paladin.ts`). Leaving `Sacred Oath MISSING` unchanged would understate current behavior.
2. The plan appears to inherit a stale assumption from the Paladin row research artifact (that Sacred Weapon executor is absent). That artifact no longer matches codebase reality.
3. Plan change bullets are mostly directionally correct, but they are not complete enough to guarantee precise row text outcomes for nuanced PARTIAL statuses (Monk, Rogue, Sorcerer, Bard). Without exact replacement rows, wording drift is likely.

## Required Fixes
1. Update Paladin row target state to `Sacred Oath PARTIAL` (at minimum: Oath of Devotion Sacred Weapon implemented; other oath mechanics still incomplete).
2. Amend Paladin input evidence in the plan to reflect live executor/registry wiring so implementation is based on current source, not stale audit text.
3. Add exact before/after markdown row replacements in the plan for all 12 class rows (not only summary bullets), preserving caveats from each row research artifact.

## Optional Improvements
1. Mark any already-updated rows in `plans/mechanics-and-coverage-report.md` as no-op in this plan to avoid duplicate or ambiguous edits.
2. Add a short normalization rule for labels (`SUPPORTED`, `PARTIAL`, `MISSING`) so row phrasing stays consistent across classes.
