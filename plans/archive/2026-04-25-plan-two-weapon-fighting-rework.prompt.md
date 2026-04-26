# Plan: Two-Weapon Fighting Rework (Light + Bonus Off-hand)
## Round: 2
## Status: COMPLETE
## Affected Flows: CombatRules, CombatOrchestration, Testing

## Objective
Rework two-weapon fighting to be deterministic and consistently enforced across parser-chain and fallback command paths. Add targeted E2E red scenarios that prove rule gates and action-economy behavior, then implement until those tests pass.

## Changes
### CombatRules
#### File: packages/game-server/src/domain/combat/two-weapon-fighting.ts
- [x] Add a pure TWF evaluator returning structured decision fields (`allowed`, `reason`, `requiresBonusAction`, `usesNick`, `offhandAddsAbilityModifier`).
- [x] Ensure evaluator inputs cover Light checks, Dual Wielder override, Attack-action prerequisite, Nick once/turn state, and TWF style damage policy.

#### File: packages/game-server/src/domain/combat/two-weapon-fighting.test.ts
- [x] Add domain tests for Light baseline, non-Light rejection, Dual Wielder override, Attack-action prerequisite, Nick once/turn behavior, and style damage policy output.

### CombatOrchestration
#### File: packages/game-server/src/application/services/combat/tabletop/action-dispatcher.ts
- [x] Centralize offhand pre-validation in one helper shared by parser-chain and fallback (`command.kind === "offhand"`) routes.
- [x] Ensure both routes produce identical legality decisions and bonus-action/Nick behavior.

#### File: packages/game-server/src/application/services/combat/tabletop/dispatch/class-ability-handlers.ts
- [x] Remove tabletop mock bypass for Attack-action prerequisite used by offhand executor.
- [x] Pass real action-usage context (`attacksUsedThisTurn > 0`) to ability execution for offhand validation.

#### File: packages/game-server/src/application/services/combat/abilities/executors/common/offhand-attack-executor.ts
- [x] Enforce Attack action prerequisite against real combat state.
- [x] Apply Dual Wielder override (via feat lookup) to Light-weapon eligibility for all offhand routing paths.
- [x] Keep Nick behavior compatible (bonus-action preservation and once/turn tracking) through existing skip-bonus-cost contract.

#### File: packages/game-server/src/application/services/combat/tabletop/roll-state-machine.ts
- [x] Prevent offhand bonus attacks from incorrectly consuming Attack action usage on miss paths.

#### File: packages/game-server/src/application/services/combat/tabletop/rolls/damage-resolver.ts
- [x] Preserve offhand no-mod damage baseline and style add-back behavior without regressions.
- [x] Prevent offhand bonus attacks from consuming Attack action usage on hit/damage completion paths.

### Testing
#### File: packages/game-server/scripts/test-harness/scenarios/core/twf-requires-attack-action.json
- [x] Add red scenario proving offhand fails before any Attack action this turn.

#### File: packages/game-server/scripts/test-harness/scenarios/core/twf-dual-wielder-non-light.json
- [x] Add red scenario proving Dual Wielder permits non-Light pair for offhand extra attack.

#### File: packages/game-server/scripts/test-harness/scenarios/core/twf-style-adds-offhand-modifier.json
- [x] Add red scenario proving TWF fighting style adds ability modifier to offhand damage.

#### File: packages/game-server/scripts/test-harness/scenarios/core/twf-parser-fallback-parity.json
- [x] Add red scenario proving parser-route and fallback-route offhand intents enforce identical outcomes.

#### File: packages/game-server/scripts/test-harness/scenarios/core/twf-nick-once-per-turn.json
- [x] Add red scenario proving Nick waives bonus action once per turn, then resets next turn.

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another?
- [x] Does the pending action state machine still have valid transitions?
- [x] Is action economy preserved (1 action, 1 bonus, 1 reaction, 1 movement)?
- [x] Do both player AND AI paths handle the change?
- [x] Are repo interfaces + memory-repos updated if entity shapes change?
- [x] Is app.ts registration updated if adding executors?
- [x] Are D&D 5e 2024 rules correct (not 2014)?

## Risks
- Parser-chain and fallback command paths currently differ for offhand handling; refactor may regress one route if not tested together.
- Nick mastery and bonus-action consumption are tightly coupled to resource flags; off-by-one turn bugs are possible.
- Existing broad E2E baseline has unrelated known failures; targeted scenario runs must be interpreted separately.

## Test Plan
- [x] Unit tests for structured domain TWF evaluator (`two-weapon-fighting.test.ts`) and orchestration prerequisite enforcement.
- [x] E2E happy path: non-Light with Dual Wielder allowed.
- [x] E2E edge path: offhand before Attack action is rejected.
- [x] E2E edge path: style damage modifier is added only to offhand when appropriate.
- [x] E2E route parity: direct parser phrase and fallback phrase behave identically.
- [x] E2E Nick lifecycle: one free Nick offhand per turn, then reset at next turn start.

## SME Approval (Complex only)
- [x] CombatRules-SME
- [x] CombatOrchestration-SME
- [x] Challenger
