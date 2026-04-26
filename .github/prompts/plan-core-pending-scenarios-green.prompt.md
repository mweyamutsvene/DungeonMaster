# Plan: Core Pending Scenarios Green
## Round: 1
## Status: IN_REVIEW
## Affected Flows: CombatRules, CombatOrchestration, Testing

## Objective
Make the five pending core combat scenarios pass by fixing the underlying rules behavior, not weakening assertions. Promote the finished scenarios into the main E2E suite and verify they pass in targeted and full runs.

## Changes
### CombatRules
#### File: packages/game-server/src/domain/combat/two-weapon-fighting.ts
- [ ] Fix off-hand damage modifier behavior so negative ability modifiers still apply when the rule requires the modifier on the bonus attack.
 - [x] Fix off-hand damage modifier behavior so negative ability modifiers still apply when the rule requires the modifier on the bonus attack.

#### File: packages/game-server/src/domain/rules/death-saves.ts
- [ ] Preserve correct death-save failure application on damage at 0 HP and clear stabilized state when damage resumes death saves.
 - [x] Preserve correct death-save failure application on damage at 0 HP and clear stabilized state when damage resumes death saves.

#### File: packages/game-server/src/domain/entities/combat/conditions.ts
- [ ] Reuse the lethal exhaustion threshold in an application-facing path so level 10 exhaustion produces a terminal result.
 - [x] Reuse the lethal exhaustion threshold in an application-facing path so level 10 exhaustion produces a terminal result.

### CombatOrchestration
#### File: packages/game-server/src/application/services/combat/tabletop/tabletop-utils.ts
- [ ] Honor Alert when computing surprise-driven initiative disadvantage.
 - [x] Honor Alert when computing surprise-driven initiative disadvantage.

#### File: packages/game-server/src/application/services/combat/action-service.ts
- [ ] Correct Dodge incoming-attack timing so attacks against the dodger stay disadvantaged until the start of the dodger's next turn.
 - [x] Correct Dodge incoming-attack timing so attacks against the dodger stay disadvantaged until the start of the dodger's next turn.

#### File: packages/game-server/src/application/services/combat/helpers/ko-handler.ts
- [ ] Clear stabilized state and keep death-save tracking consistent when a 0 HP character takes more damage.
 - [x] Clear stabilized state and keep death-save tracking consistent when a 0 HP character takes more damage.

#### File: packages/game-server/src/infrastructure/api/routes/sessions/session-combat.ts
- [ ] Enforce lethal exhaustion when DM/test harness applies an exhaustion condition directly.
 - [x] Enforce lethal exhaustion when DM/test harness applies an exhaustion condition directly.

### Testing
#### File: packages/game-server/src/domain/combat/two-weapon-fighting.test.ts
- [ ] Update unit coverage for negative off-hand modifiers.
 - [x] Update unit coverage for negative off-hand modifiers.

#### File: packages/game-server/src/application/services/combat/tabletop/rolls/initiative-handler.test.ts
- [ ] Add Alert versus party-surprise coverage.
 - [x] Add Alert versus party-surprise coverage.

#### File: packages/game-server/scripts/test-harness/scenarios/core/*.json
- [ ] Promote the five pending RED scenarios into the main scenarios folder after the engine behavior is green.
 - [x] Promote the five pending RED scenarios into the main scenarios folder after the engine behavior is green.

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another?
- [x] Does the pending action state machine still have valid transitions?
- [x] Is action economy preserved (1 action, 1 bonus, 1 reaction, 1 movement)?
- [x] Do both player AND AI paths handle the change?
- [x] Are repo interfaces + memory-repos updated if entity shapes change?
- [x] Is app.ts registration updated if adding executors?
- [x] Are D&D 5e 2024 rules correct (not 2014)?

## Risks
- Rule fixes touch shared combat paths, so each slice needs a narrow validation first before running the full E2E gate.

## Test Plan
- [x] Unit tests for new/changed logic in two-weapon-fighting, initiative surprise handling, and lethal exhaustion entry points.
- [x] E2E scenarios for Alert surprise immunity, death-save damage-at-0 branches, Dodge timing, exhaustion level 10, and off-hand negative modifier behavior.
- [x] Edge case validation for stabilized-to-damage reset, incoming attack timing boundaries, and party surprise multi-PC initiative behavior.

## SME Approval (Complex only)
- [ ] CombatRules-SME
- [ ] CombatOrchestration-SME

## Open Issues
- Global `test:e2e:combat:mock -- --all` currently fails in unrelated wizard material-component scenarios (`wizard/dispel-magic-concentration-break`, `wizard/revivify-material-component`) due strict required component validation (`Holy Symbol worth 5+ GP`). This predates the five promoted scenario fixes and is not in scope of the pending-scenarios promotion.