# Plan: Grapple/Shove 2024 Follow-ups
## Round: 1
## Status: DRAFT
## Affected Flows: CombatOrchestration, Testing

## Objective
Add deeper tabletop-specific contest transition regression coverage and expanded shove branch scenario depth beyond the save-proficiency parity fix.

## Changes
### CombatOrchestration
#### File: packages/game-server/src/application/services/combat/tabletop/roll-state-machine.contest.integration.test.ts
- [ ] Add tabletop contest regression test for pending-action transitions: ATTACK(contestType) resolves directly and clears pending action (no DAMAGE pending action).
- [ ] Add tabletop contest assertions for one-attack consumption per attempt across miss and hit/save-success branches.

### Testing
#### File: packages/game-server/scripts/test-harness/scenarios/core/grapple-shove-save-proficiency.json
- [ ] Extend scenario to include shove push and shove prone save-proficiency/tie branches.
- [ ] Add explicit tie-at-DC resistance assertion for shove contest.
