# Plan: Mechanics Coverage Refresh (R2-Validated)
## Round: 1
## Status: COMPLETE
## Affected Flows: multi (all 13 + E2E)

## Objective
Refresh the consolidated mechanics report and per-flow audit files using the R2 SME validations that include E2E execution evidence. Remove temporary SME research artifacts created during this chat after the audit/report files are updated.

## Changes
### Reporting
#### File: plans/mechanics-and-coverage-report.md
- [x] Apply all R2-validated status/corrections by section and table
- [x] Reconcile contradictory claims between executive summary and flow sections
- [x] Update scenario-count/coverage statements to R2 baseline

### Per-flow audits
#### Files: plans/audit-*.md
- [x] Update stale findings in each flow audit using corresponding R2 report
- [x] Keep unresolved items as missing/partial with confidence notes

### Cleanup
#### Files: plans/sme-research-*.md and plans/sme-research-*-r2.md
- [x] Delete all chat-generated SME research artifacts after migration

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another?
- [x] Does the pending action state machine still have valid transitions?
- [x] Is action economy preserved (1 action, 1 bonus, 1 reaction, 1 movement)?
- [x] Do both player AND AI paths handle the change?
- [x] Are repo interfaces + memory-repos updated if entity shapes change?
- [x] Is app.ts registration updated if adding executors?
- [x] Are D&D 5e 2024 rules correct (not 2014)?

## Risks
- Report edits may drift from code if not all claims are sourced to R2 validation files.
- Deleting SME files before migration completeness can lose context.

## Test Plan
- [x] Verify every modified claim has a matching citation from R2 files or current source.
- [x] Spot-check at least 3 critical mechanics rows against source text after edits.
- [x] Confirm no SME files remain after cleanup and that only intended docs changed.

## SME Approval (Complex only)
- [x] CombatRules-SME
- [x] ClassAbilities-SME
- [x] SpellSystem-SME
- [x] SpellCatalog-SME
- [x] CombatOrchestration-SME
- [x] ActionEconomy-SME
- [x] ReactionSystem-SME
- [x] CombatMap-SME
- [x] AIBehavior-SME
- [x] AISpellEvaluation-SME
- [x] EntityManagement-SME
- [x] CreatureHydration-SME
- [x] InventorySystem-SME
- [x] Testing (E2E) SME
