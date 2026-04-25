# Plan: Hide Rework Mechanics
## Round: 1
## Status: COMPLETE
## Affected Flows: CombatRules, CombatOrchestration

## Objective
Rework Hide so it behaves like 2024 stealth gameplay in deterministic combat: it should require non-clear visibility context and resolve against observer passive Perception at hide time. Add a strong E2E scenario first that fails on current behavior, then implement the minimal architectural changes to make it pass without weakening assertions.

## Changes
### CombatOrchestration
#### File: packages/game-server/scripts/test-harness/scenarios/core/hide-stealth-vs-passive.json
- [x] Add deterministic E2E scenario where Hide should fail against high passive Perception (with cover present) and assert no Hidden condition.

#### File: packages/game-server/src/application/services/combat/action-handlers/skill-action-handler.ts
- [x] Derive hide visibility context from encounter map and combatant positions instead of hardcoded assumptions.
- [x] Resolve opposing observers and compute passive Perception threshold for hide contest.
- [x] Pass observer passive threshold into domain hide resolution and keep existing action-economy behavior unchanged.

### CombatRules
#### File: packages/game-server/src/domain/rules/hide.ts
- [x] Extend hide resolution to fail when stealth does not beat observer passive Perception.

#### File: packages/game-server/src/domain/rules/hide.test.ts
- [x] Add/adjust unit coverage for passive Perception gating while keeping existing cover/visibility checks.

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another?
- [x] Does the pending action state machine still have valid transitions?
- [x] Is action economy preserved (1 action, 1 bonus, 1 reaction, 1 movement)?
- [x] Do both player AND AI paths handle the change?
- [x] Are repo interfaces + memory-repos updated if entity shapes change?
- [x] Is app.ts registration updated if adding executors?
- [x] Are D&D 5e 2024 rules correct (not 2014)?

## Risks
- Observer perception derivation now honors explicit passivePerception values from stat blocks via combatant resolver; remaining risk is cover/LOS edge fidelity on unusual map states.
- Hide bonus-action consumption quirks are out of this scope and must not be implicitly changed by this rework.

## Test Plan
- [x] Unit tests for hide passive-perception contest in packages/game-server/src/domain/rules/hide.test.ts
- [x] E2E scenario happy-path-for-failure-check in packages/game-server/scripts/test-harness/scenarios/core/hide-stealth-vs-passive.json
- [x] Edge case assertions for no Hidden condition when hide fails despite cover

## SME Approval (Complex only)
- [x] CombatRules-SME
- [x] CombatOrchestration-SME

## Verification
- [x] `pnpm -C packages/game-server typecheck`
- [x] `pnpm -C packages/game-server exec vitest run src/domain/rules/hide.test.ts --reporter=verbose`
- [x] `pnpm -C packages/game-server test:e2e:combat:mock -- --scenario=core/hide-stealth-vs-passive --no-color`
