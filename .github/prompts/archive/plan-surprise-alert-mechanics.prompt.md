# Plan: Surprise + Alert Mechanics Hardening
## Round: 1
## Status: COMPLETE
## Affected Flows: CombatRules, CombatOrchestration, Testing

## Objective
Close the remaining Surprise + Alert fidelity gaps with test-first development. Start with a high-signal failing E2E that captures a 2024 initiative edge case, then implement only after the red scenario is in place.

## Changes
### Testing
#### File: packages/game-server/scripts/test-harness/scenarios/core/surprise-alert-willing-swap-red.json
- [x] Add a deterministic red scenario that combines surprise initiative disadvantage with Alert swap behavior.
- [x] Assert Alert holder receives disadvantage when the party is surprised.
- [x] Assert an attempted swap with an unconscious ally is rejected.

#### File: packages/game-server/scripts/test-harness/scenario-runner.ts
- [x] Add `rollResult.expect.currentTurnActor` assertion support so initiative ownership can be validated directly in E2E scenarios.

### CombatRules
#### File: packages/game-server/src/domain/rules/hide.ts
- [x] Integrate hide/passive-perception surprise determination with encounter setup where applicable.
- [x] Ensure surprise state remains deterministic and traceable for E2E assertions.

### CombatOrchestration
#### File: packages/game-server/src/application/services/combat/tabletop/rolls/initiative-handler.ts
- [x] Enforce Alert swap target eligibility as willing/capable ally (exclude unconscious/incapacitated allies).
- [x] Preserve initiative order when swap target is invalid and return explicit feedback.

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another?
- [x] Does the pending action state machine still have valid transitions?
- [x] Is action economy preserved (1 action, 1 bonus, 1 reaction, 1 movement)?
- [x] Do both player AND AI paths handle the change?
- [x] Are repo interfaces + memory-repos updated if entity shapes change?
- [x] Is app.ts registration updated if adding executors? (N/A: no executor additions)
- [x] Are D&D 5e 2024 rules correct (not 2014)?

## Risks
- Over-constraining Alert eligibility could reject legitimate swaps. Mitigation: implement capability checks narrowly (only clearly non-willing states) and add focused unit tests.
- Surprise computation can drift between DM override and stealth-derived paths. Mitigation: keep DM override precedence explicit.

## Test Plan
- [x] Unit tests for initiative swap eligibility filtering (willing vs unconscious/incapacitated).
- [x] E2E red scenario for surprise + Alert swap invalid target (`core/surprise-alert-willing-swap-red.json`).
- [x] E2E follow-up (green) for valid swap target after implementation.

## SME Approval (Complex only)
- [ ] CombatRules-SME
- [ ] CombatOrchestration-SME
