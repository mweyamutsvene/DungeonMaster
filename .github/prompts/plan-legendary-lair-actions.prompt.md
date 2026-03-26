# Plan: Legendary Actions & Lair Actions for Boss Monsters
## Round: 1
## Status: COMPLETE
## Affected Flows: EntityManagement, CombatRules, CombatOrchestration, AIBehavior

## Objective
Implement D&D 5e 2024 Legendary Actions and Lair Actions for boss monsters. Legendary actions allow certain monsters to act between other creatures' turns by spending charges (reset at start of their own turn). Lair actions trigger at initiative count 20 once per round.

## Changes

### EntityManagement
#### [File: domain/entities/creatures/legendary-actions.ts] — NEW
- [x] Define `LegendaryActionDef` type: `{ name, cost, description, actionType: 'attack' | 'move' | 'special' }`
- [x] Define `LairActionDef` type: `{ name, description, saveDC?, saveAbility?, damage?, effect? }`
- [x] Define `LegendaryTraits` type grouping legendary + lair configs on a monster
- [x] Helper `parseLegendaryTraits(statBlock)` to extract from JSON stat block

#### [File: helpers/creature-hydration.ts]
- [x] In `hydrateMonster()`: extract legendary traits from statBlock
- [x] Initialize `legendaryActionsRemaining` in combatant resources when starting encounter

### CombatRules
#### [File: helpers/resource-utils.ts]
- [x] Add `getLegendaryActionsRemaining(resources)` helper
- [x] Add `spendLegendaryAction(resources, cost)` helper  
- [x] Add `resetLegendaryActions(resources, max)` helper
- [x] Modify `resetTurnResources()` — do NOT reset legendary charges there (they reset at boss's own turn start, not every turn)

### CombatOrchestration
#### [File: combat-service.ts]
- [x] In `nextTurn()` — after advancing turn, before processing conditions:
  - Check if any boss monsters have legendary action charges remaining
  - Call legendary action handler for eligible bosses
  - Deduct charges for any used actions
- [x] At start of boss's own turn: reset legendary charges to max

### AIBehavior
#### [File: ai/legendary-action-handler.ts] — NEW
- [x] `LegendaryActionHandler` class with deterministic heuristics
- [x] `chooseLegendaryAction(boss, combatants, availableActions, chargesRemaining)` method
- [x] Heuristics: spread actions across round, prioritize by combat state

#### [File: ai-turn-orchestrator.ts]
- [x] Add method to execute legendary actions between turns
- [x] Call from the turn advancement hook

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? — No, legendary actions are additive
- [x] Does the pending action state machine still have valid transitions? — Yes, legendary actions execute outside the pending action flow
- [x] Is action economy preserved (1 action, 1 bonus, 1 reaction, 1 movement)? — Yes, legendary actions are separate from normal action economy
- [x] Do both player AND AI paths handle the change? — AI-only for v1 (boss monsters are AI-controlled)
- [x] Are repo interfaces + memory-repos updated if entity shapes change? — No new entity shapes, just resources JSON fields
- [x] Is `app.ts` registration updated if adding executors? — No new executors needed
- [x] Are D&D 5e 2024 rules correct (not 2014)? — Yes

## Risks
- Turn advancement loop complexity — mitigated by keeping legendary action execution simple and non-blocking
- Infinite loop risk if legendary action triggers more legendary actions — mitigated by only allowing legendary actions after non-boss turns
- Performance — mitigated by checking boss existence/charges before doing any work

## Test Plan
- [x] Unit test: legendary action charge reset at start of boss turn (resource-utils-legendary.test.ts)
- [x] Unit test: legendary action deducts correct charge cost (resource-utils-legendary.test.ts)
- [x] Unit test: can't use legendary action when incapacitated (legendary-action-handler.test.ts)
- [x] Unit test: can't use legendary action when charges = 0 (legendary-action-handler.test.ts)
- [x] Unit test: lair action parsing (legendary-actions.test.ts)
- [x] E2E scenario: `core/legendary-actions.json` — full 3-round combat with boss using legendary Bone Lash attacks between player turns

## Additional Fixes (discovered during E2E testing)
- [x] initiative-handler.ts: Added legendary resource initialization from monster statBlock (was only in combat-service.ts startEncounter, which tabletop flow bypasses)
- [x] ai-turn-orchestrator.ts: Rewrote executeLegendaryAttack to resolve attacks directly (d20+bonus vs AC) instead of using actionService.attack() which incorrectly consumed the boss's action economy
