# Plan: E2E Bug Reproduction & Fixes from Agent Test Plays H/I/J
## Round: 1
## Status: COMPLETED
## Affected Flows: AIBehavior, CombatOrchestration

## Objective
Convert bugs found during agent test plays (wounded-fighter, solo-paladin, party-dungeon) into deterministic E2E test scenarios, then fix the underlying issues. Two primary bugs:
1. **AI melee out-of-range attack**: Deterministic AI returns `attack` decision when melee creature is out of reach (e.g. 10ft with 5ft reach) after movement is already spent
2. **Compound move+attack silently drops attack**: `tryParseMoveText` strips "and attack..." suffix, silently discarding the player's attack intent

## Changes

### AIBehavior
#### [File: application/services/combat/ai/deterministic-ai.ts]
- [x] In Step 5 (attack), after the in-reach target search, add guard: if melee creature has no target in reach AND movement is already spent, end turn instead of attacking from out of range
- [x] If movement is NOT spent, issue a `moveToward` instead of an attack for out-of-range melee targets

### CombatOrchestration  
#### [File: application/services/combat/tabletop/combat-text-parser.ts]
- [x] In `tryParseMoveText`: Return null when compound suffix ("and attack/strike/etc") is detected, instead of stripping it
- [x] In `tryParseMoveTowardText`: Same change — return null for compound text

#### [File: application/services/combat/tabletop/action-dispatcher.ts]
- [x] Add new "compound:moveAndAttack" parser entry at position #0 in the chain
- [x] Compound parser: extracts move destination + attack target/weapon from "move to (X,Y) and attack [target] [with weapon]"
- [x] Handler: executes move first, if REACTION_CHECK return that, otherwise proceeds to attack and returns attack roll request

#### [File: application/services/combat/tabletop/combat-text-parser.ts]
- [x] Add new `tryParseCompoundMoveAttack` function to extract both move coords and attack intent from compound text

### E2E Scenarios
#### [File: scripts/test-harness/scenarios/core/ai-melee-range-guard.json]
- [x] Scenario: Melee monster starts 15ft from player (1 square gap), has 30ft speed, moves toward player but ends at 10ft (blocked or partial). Verify AI does NOT attack from 10ft.

#### [File: scripts/test-harness/scenarios/core/compound-move-attack.json]  
- [x] Scenario: Player sends "move to (X,Y) and attack Goblin with longsword". Verify BOTH move AND attack execute.

#### [File: scripts/test-harness/scenarios/core/weapon-selection-hint.json]
- [x] Scenario: Fighter with Longsword + Handaxe sends "I attack Goblin with my longsword". Verify correct weapon is used (check damage dice = 1d8+3 not 1d6+3).

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? — No, AI fix is isolated to decision-making. Parser fix adds new parser entry before existing ones.
- [x] Does the pending action state machine still have valid transitions? — Yes, compound handler reuses existing move+attack handlers.
- [x] Is action economy preserved? — Yes, move + attack in same turn is standard D&D.
- [x] Do both player AND AI paths handle the change? — AI fix is AI-only. Compound command is player-text-only.
- [x] Are repo interfaces + memory-repos updated? — No entity shape changes.
- [x] Is `app.ts` registration updated if adding executors? — N/A.
- [x] Are D&D 5e 2024 rules correct? — Yes, move + attack on same turn is standard.

## Risks
- Compound handler: If move triggers REACTION_CHECK, the attack intent is lost. Mitigation: return clear message "Move paused for reactions. Send attack separately after."
- AI range fix: May cause AI to end turn "early" when no target in reach. This is correct behavior — better than a 400 error.

## Test Plan
- [x] E2E: ai-melee-range-guard.json — Monster at 10ft, melee 5ft reach, movement spent → ends turn
- [x] E2E: compound-move-attack.json — "move to X and attack Y" → both execute 
- [x] E2E: weapon-selection-hint.json — "attack X with my longsword" → correct weapon
- [x] Existing E2E: all scenarios pass (no regressions)
