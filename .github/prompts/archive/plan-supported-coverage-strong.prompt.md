# Plan: Promote Supported Weak/Moderate Mechanics To STRONG Coverage
## Round: 1
## Status: IN_REVIEW
## Affected Flows: CombatRules, SpellSystem, Testing

## Objective
Raise every mechanic currently marked as SUPPORTED but WEAK/MODERATE in the mechanics report to STRONG coverage by adding or extending deterministic tests. Keep this file as the execution ledger for progress continuity.

## Source Scope
Working report: plans/mechanics-and-coverage-report.md
Target rows: every table row where Status=SUPPORTED and Coverage=WEAK or MODERATE.

## Changes
### Plan + Baseline Audit
- [x] Extract all target mechanics from report
- [x] Map each target mechanic to current scenario/test files and identify assertion gaps
- [x] Build a minimal additive test matrix (new scenarios + scenario edits + unit tests)

### CombatRules Coverage Upgrades
- [x] Temp HP absorption
- [x] Conditions (supported set)
- [x] Exhaustion (2024)
- [x] Grapple + shove
- [x] Grapple escape action
- [x] Cover (AC)
- [x] Cover + Dex save bonus from AoE
- [x] Dodge / Disengage / Dash
- [x] Help / Search / Ready / Use Object
- [x] Unarmed strikes

### SpellSystem Coverage Upgrades
- [x] Delivery modes (attack/save/heal/buff/zone/auto-hit)
- [x] Upcasting (dice + flat)
- [x] Cantrip scaling (L1/L5/L11/L17)
- [x] Counterspell (2024)
- [x] Verbal component enforcement
- [x] Dispel Magic
- [x] Haste speed multiplier

### Report Updates
- [x] Update mechanics-and-coverage-report.md coverage statuses and notes for each upgraded mechanic
- [x] Add a concise “Coverage upgrade evidence” subsection listing scenario/test files

## Cross-Flow Risk Checklist
- [ ] Do changes in one flow break assumptions in another?
- [ ] Does the pending action state machine still have valid transitions?
- [ ] Is action economy preserved (1 action, 1 bonus, 1 reaction, 1 movement)?
- [ ] Do both player AND AI paths handle the change?
- [ ] Are repo interfaces + memory-repos updated if entity shapes change?
- [ ] Is app.ts registration updated if adding executors?
- [ ] Are D&D 5e 2024 rules correct (not 2014)?

## Risks
- Creating many tiny scenarios may increase runtime without meaningfully increasing confidence.
- Broad “STRONG” claims can become stale if not tied to explicit scenario evidence.

## Open Issues (Verification)
- 2026-04-25 full `pnpm -C packages/game-server test` is failing outside this thread's scope at `src/infrastructure/api/app.test.ts` (`tabletop miss prompts Lucky spend and resumes reroll via reactions endpoint`, `luckyPrompt` undefined).
- 2026-04-25 full `pnpm -C packages/game-server test:e2e:combat:mock -- --all --no-color` reports one failing scenario outside this thread's scope: `feat/lucky-reroll` (5/11), while all newly added coverage scenarios pass.

## Test Plan
- [x] Add/extend E2E scenarios to raise all CombatRules targets to STRONG evidence depth
- [x] Add/extend E2E scenarios to raise all SpellSystem targets to STRONG evidence depth
- [x] Add/extend Vitest tests for spell-delivery and scaling branches where E2E depth is currently thin
- [x] Run targeted scenario set for new/edited files
- [ ] Run pnpm -C packages/game-server test
- [ ] Run pnpm -C packages/game-server test:e2e:combat:mock -- --all

## SME Approval (Complex only)
- [ ] CombatRules-SME
- [ ] SpellSystem-SME
- [ ] Challenger