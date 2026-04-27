---
type: challenge
flow: multi
feature: grapple-shove-2024-unarmed
author: Challenger
status: IN_REVIEW
round: 1
created: 2026-04-26
updated: 2026-04-26
---

# Plan Challenge — Grapple Shove 2024 Unarmed

## Verdict
PASS_WITH_FIXES

## Critical Issues
1. Add explicit tabletop pending-action regression coverage for contest flows (`ATTACK(contestType)` resolves and clears, with no `DAMAGE` pending step).
2. Add explicit attack-slot consumption assertions for hit/miss and save pass/fail branches in both tabletop and programmatic paths.
3. Ensure callsite update checklist when domain contest helper signature changes.

## Edge Cases to Cover
1. Save tie at DC resists (including proficiency bonus).
2. Auto-fail STR/DEX conditions override proficiency benefit.
3. Multi-attack actor consumes exactly one attack per grapple/shove attempt.
4. Pending action clears after contest resolution and never gets stuck.
