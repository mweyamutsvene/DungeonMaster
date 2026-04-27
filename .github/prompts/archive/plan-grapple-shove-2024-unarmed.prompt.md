# Plan: Grapple + Shove 2024 Unarmed Contest Fidelity
## Round: 1
## Status: APPROVED
## Affected Flows: CombatRules, CombatOrchestration, ActionEconomy

## Objective
Align Grapple/Shove 2024 unarmed contest behavior across programmatic and tabletop paths so both use equivalent save-modifier logic and deterministic outcomes. Add regression coverage that proves attack-slot consumption and contest resolution remain correct for hit/miss and save-fail/save-success branches.

## Changes
### CombatRules
#### File: packages/game-server/src/domain/rules/grapple-shove.ts
- [x] Extend contest helper inputs to accept full save modifiers (STR/DEX including proficiency where applicable) instead of raw ability modifiers only.
- [x] Keep target choice semantics as "target chooses better STR/DEX save total" and preserve existing auto-fail and exhaustion hooks.
- [x] Add a shared contest save-modifier helper usable by both programmatic and tabletop paths to reduce future drift.

#### File: packages/game-server/src/domain/rules/grapple-shove.test.ts
- [x] Add unit tests validating save proficiency affects grapple/shove resistance outcome and ties still resist.
- [x] Add unit test validating escape-grapple skill bonus path remains deterministic with provided athletics/acrobatics bonuses.

### CombatOrchestration
#### File: packages/game-server/src/application/services/combat/action-handlers/grapple-action-handler.ts
- [x] Pass fully computed save modifiers into domain grapple/shove helpers using resolver-provided save proficiencies.
- [x] Keep multi-attack consumption behavior unchanged (grapple/shove consumes one attack slot, not entire action if attacks remain).
- [x] Add callsite checklist updates for all changed helper signatures (programmatic handlers, AI handlers, and domain tests).

#### File: packages/game-server/src/application/services/combat/action-service.grapple-shove.integration.test.ts
- [x] Add integration test proving programmatic grapple uses target save proficiency in contest branch.
- [x] Add integration assertions for attack-slot consumption parity on hit and miss branches.

#### File: packages/game-server/src/application/services/combat/tabletop/roll-state-machine.contest.integration.test.ts
- [x] Deferred to .github/prompts/plan-grapple-shove-2024-followups.prompt.md
- [x] Deferred to .github/prompts/plan-grapple-shove-2024-followups.prompt.md

### Testing
#### File: packages/game-server/scripts/test-harness/scenarios/core/grapple-shove-save-proficiency.json
- [x] Add deterministic E2E scenario covering a save-proficient target resisting grapple/shove while non-proficient control target fails under equivalent base stats.
- [x] Deferred branch-depth extension to .github/prompts/plan-grapple-shove-2024-followups.prompt.md

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another?
- [x] Does the pending action state machine still have valid transitions?
- [x] Is action economy preserved (1 action, 1 bonus, 1 reaction, 1 movement)?
- [x] Do both player AND AI paths handle the change?
- [x] Are repo interfaces + memory-repos updated if entity shapes change?
- [x] Is app.ts registration updated if adding executors?
- [x] Are D&D 5e 2024 rules correct (not 2014)?

## Risks
- Contest-save modifier rules can diverge again if tabletop and programmatic paths recompute modifiers differently in future.
- Integration setup for grapple path is state-heavy; brittle fixture data could make tests flaky if not deterministic.

## Test Plan
- [x] Unit tests for domain contest math and escape checks in packages/game-server/src/domain/rules/grapple-shove.test.ts
- [x] Integration test for programmatic grapple save-proficiency behavior and attack-slot parity in packages/game-server/src/application/services/combat/action-service.grapple-shove.integration.test.ts
- [x] Integration test for tabletop contest pending-action transitions and attack-slot parity deferred to .github/prompts/plan-grapple-shove-2024-followups.prompt.md
- [x] E2E scenario for tabletop grapple/shove save-proficiency branches in packages/game-server/scripts/test-harness/scenarios/core/ai-grapple-save-proficiency.json

## SME Approval (Complex only)
- [x] CombatRules-SME
- [x] CombatOrchestration-SME
- [x] Challenger
