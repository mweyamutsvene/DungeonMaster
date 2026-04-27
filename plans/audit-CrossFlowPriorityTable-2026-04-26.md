---
type: report
flow: multi
feature: crossflow-priority-table-reaudit
author: DMDeveloper
status: COMPLETE
created: 2026-04-26
updated: 2026-04-26
---

# Cross-Flow Priority Table Re-Audit (2026-04-26)

## Scope
Re-audited section 4 (`Cross-Flow Priority Table`) in `plans/mechanics-and-coverage-report.md` using flow SMEs:
- ClassAbilities-SME
- SpellSystem-SME
- EntityManagement-SME
- ReactionSystem-SME
- CombatRules-SME

Input artifacts:
- `plans/sme-feedback-crossflow-priority-ClassAbilities-2026-04-26.md`
- `plans/sme-feedback-crossflow-priority-SpellSystem-2026-04-26.md`
- `plans/sme-feedback-crossflow-priority-EntityManagement-2026-04-26.md`
- `plans/sme-feedback-crossflow-priority-ReactionSystem-2026-04-26.md`
- `plans/sme-feedback-crossflow-priority-CombatRules-2026-04-26.md`

## Findings Summary
- Updated Tier 1 rows: #1, #6, #8, #9b, #10, #11, #12, #18
- Updated Tier 2 rows: #1, #2, #9, #10, #14, #15, #17
- Kept unchanged where accurate after SME checks.

## Key Corrections Applied
1. Clarified roll-interrupt DONE scope: attack/save paths are done; concentration damage saves do not route through pending roll-interrupt.
2. Downgraded Dispel Magic from DONE to PARTIAL due to concentration-target-focused runtime scope.
3. Marked background pipeline as DONE (implemented in character creation with tests).
4. Reframed subclass status to breadth-gap rather than broad missing claim.
5. Corrected grouped class-feature runtime row from DONE to mixed coverage.
6. Corrected patron hook row: Dark One's Blessing KO triggers are wired.
7. Corrected Sear Undead row to MISSING (Destroy Undead threshold is not the 2024 Sear rider).
8. Updated Tier 2 states: forced movement PARTIAL, crit dice-vs-flat SUPPORTED, reaction feat coverage PARTIAL, reach/hidden map rows PARTIAL, ASI merging PARTIAL.

## Notes
This re-audit was limited to section 4 accuracy and did not execute new implementation work.
