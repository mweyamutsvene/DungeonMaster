---
type: challenge
flow: multi
feature: classabilities-row-staleness-2026-04-26
author: Challenger
status: IN_REVIEW
round: 2
created: 2026-04-26
updated: 2026-04-26
---

# Critical Issues

1. Taxonomy drift is reduced but not fully resolved: the plan still normalizes around `SUP` shorthand plus mixed qualifiers (`cross-flow`, `inline`, `defs`, `shell`) instead of one strict status vocabulary in final row cells.
2. Contradiction handling is still procedural, not explicit: the plan says to resolve disputed cells conservatively, but does not record per-cell dispositions for previously disputed rows (Monk, Ranger, Warlock).

# Medium Issues

1. Exact replacements concern is largely resolved: all class rows now have explicit before/after text, including Druid no-op verification.
2. Stale-assumption concern is largely resolved: Paladin and Druid stale baseline issues from round 1 are corrected in-plan.
3. Evidence-gate wording remains soft: test plan still frames status-upgrade validation as smoke checks rather than mandatory checks for every promoted claim.

# Suggested Fixes

1. Lock final row-cell statuses to `SUPPORTED | PARTIAL | MISSING | UNVERIFIED`; keep shorthand/qualifiers only in parenthetical caveats.
2. Add a short Disputed Cell Disposition block mapping each prior disputed row/cell to ACCEPTED or DEFERRED with one-line rationale.
3. Tighten test gate language so each `MISSING -> PARTIAL/SUPPORTED` upgrade requires explicit runtime-path + scenario/test confirmation before merge.

# Verdict (BLOCKED | PASS_WITH_FIXES)

PASS_WITH_FIXES
