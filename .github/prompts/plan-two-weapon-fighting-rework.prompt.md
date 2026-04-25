# Plan: Two-Weapon Fighting Rework (Light + Bonus Off-hand)
## Round: 2
## Status: IN_REVIEW
## Affected Flows: CombatRules, CombatOrchestration, Testing

## Objective
Rework two-weapon fighting to be deterministic and consistently enforced across parser-chain and fallback command paths. Add targeted E2E red scenarios that prove rule gates and action-economy behavior, then implement until those tests pass.

## Changes
### CombatRules
#### File: packages/game-server/src/domain/combat/two-weapon-fighting.ts
- [ ] Add a pure TWF evaluator returning structured decision fields (`allowed`, `reason`, `requiresBonusAction`, `usesNick`, `offhandAddsAbilityModifier`).
- [ ] Ensure evaluator inputs cover Light checks, Dual Wielder override, Attack-action prerequisite, Nick once/turn state, and TWF style damage policy.

#### File: packages/game-server/src/domain/combat/two-weapon-fighting.test.ts
- [ ] Add domain tests for Light baseline, non-Light rejection, Dual Wielder override, Attack-action prerequisite, Nick once/turn behavior, and style damage policy output.

### CombatOrchestration
#### File: packages/game-server/src/application/services/combat/tabletop/action-dispatcher.ts
- [ ] Centralize offhand pre-validation in one helper shared by parser-chain and fallback (`command.kind === "offhand"`) routes.
- [ ] Ensure both routes produce identical legality decisions and bonus-action/Nick behavior.

#### File: packages/game-server/src/application/services/combat/tabletop/dispatch/class-ability-handlers.ts
- [ ] Remove tabletop mock bypass for Attack-action prerequisite used by offhand executor.
- [ ] Pass real action-usage context (`attacksUsedThisTurn > 0`) to ability execution for offhand validation.

#### File: packages/game-server/src/application/services/combat/abilities/executors/common/offhand-attack-executor.ts
- [ ] Enforce Attack action prerequisite against real combat state.
- [ ] Apply Dual Wielder override (via feat lookup) to Light-weapon eligibility for all offhand routing paths.
- [ ] Keep Nick behavior compatible (bonus-action preservation and once/turn tracking) through existing skip-bonus-cost contract.

#### File: packages/game-server/src/application/services/combat/tabletop/roll-state-machine.ts
- [ ] Prevent offhand bonus attacks from incorrectly consuming Attack action usage on miss paths.

#### File: packages/game-server/src/application/services/combat/tabletop/rolls/damage-resolver.ts
- [ ] Preserve offhand no-mod damage baseline and style add-back behavior without regressions.
- [ ] Prevent offhand bonus attacks from consuming Attack action usage on hit/damage completion paths.

### Testing
#### File: packages/game-server/scripts/test-harness/scenarios/core/twf-requires-attack-action.json
- [ ] Add red scenario proving offhand fails before any Attack action this turn.

#### File: packages/game-server/scripts/test-harness/scenarios/core/twf-dual-wielder-non-light.json
- [ ] Add red scenario proving Dual Wielder permits non-Light pair for offhand extra attack.

#### File: packages/game-server/scripts/test-harness/scenarios/core/twf-style-adds-offhand-modifier.json
- [ ] Add red scenario proving TWF fighting style adds ability modifier to offhand damage.

#### File: packages/game-server/scripts/test-harness/scenarios/core/twf-parser-fallback-parity.json
- [ ] Add red scenario proving parser-route and fallback-route offhand intents enforce identical outcomes.

#### File: packages/game-server/scripts/test-harness/scenarios/core/twf-nick-once-per-turn.json
- [ ] Add red scenario proving Nick waives bonus action once per turn, then resets next turn.

## Cross-Flow Risk Checklist
- [ ] Do changes in one flow break assumptions in another?
- [ ] Does the pending action state machine still have valid transitions?
- [ ] Is action economy preserved (1 action, 1 bonus, 1 reaction, 1 movement)?
- [ ] Do both player AND AI paths handle the change?
- [ ] Are repo interfaces + memory-repos updated if entity shapes change?
- [ ] Is app.ts registration updated if adding executors?
- [ ] Are D&D 5e 2024 rules correct (not 2014)?

## Risks
- Parser-chain and fallback command paths currently differ for offhand handling; refactor may regress one route if not tested together.
- Nick mastery and bonus-action consumption are tightly coupled to resource flags; off-by-one turn bugs are possible.
- Existing broad E2E baseline has unrelated known failures; targeted scenario runs must be interpreted separately.

## Test Plan
- [ ] Unit tests for structured domain TWF evaluator (`two-weapon-fighting.test.ts`) and orchestration prerequisite enforcement.
- [ ] E2E happy path: non-Light with Dual Wielder allowed.
- [ ] E2E edge path: offhand before Attack action is rejected.
- [ ] E2E edge path: style damage modifier is added only to offhand when appropriate.
- [ ] E2E route parity: direct parser phrase and fallback phrase behave identically.
- [ ] E2E Nick lifecycle: one free Nick offhand per turn, then reset at next turn start.

## SME Approval (Complex only)
- [ ] CombatRules-SME
- [ ] CombatOrchestration-SME
- [ ] Challenger
