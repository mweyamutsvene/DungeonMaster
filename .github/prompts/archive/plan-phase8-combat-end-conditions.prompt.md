# Plan: Phase 8 — Combat End Conditions & Help Action Verification
## Round: 1
## Status: DRAFT
## Affected Flows: CombatOrchestration

## Objective
Add flee/surrender combat end conditions (currently only total elimination ends combat) and verify the Help action actually grants a consumable advantage effect. These are important for natural D&D gameplay flow.

## Changes

### CombatOrchestration — Flee/Surrender

#### [File: application/services/combat/combat-victory-policy.ts]
- [ ] Add `CombatEndCondition` types: `elimination`, `flee`, `surrender`, `dm_end`
- [ ] `flee`: all enemies have fled the battlefield (moved off map or used Disengage + moved to designated exit)
- [ ] `surrender`: explicit surrender action by faction leader or majority of faction
- [ ] `dm_end`: DM/player manually ends combat via API

#### [File: infrastructure/api/routes/sessions/session-combat.ts]
- [ ] Add `POST .../combat/end` endpoint that allows manually ending combat with a reason
- [ ] Include combat result summary (who fled, who surrendered, who died)

#### [File: application/services/combat/combat-service.ts]
- [ ] Track "fled" status on combatants who leave the battlefield
- [ ] When all enemies with `fled` or `dead` status → combat ends
- [ ] Emit `CombatEnded` event with appropriate result type

#### [File: application/services/combat/ai/handlers/ or action-handlers/]
- [ ] Support "flee" action: Disengage + move to map exit point
- [ ] Support "surrender" action: end hostilities for faction

### CombatOrchestration — Help Action Verification

#### [File: application/services/combat/action-handlers/skill-action-handler.ts]
- [ ] Verify that `help()` creates an `ActiveEffect` with `advantage` on the next `attack_roll` against the Help target
- [ ] The advantage should be consumable (used once, then removed)
- [ ] Scope: the advantage applies to the next attack by the helped ally against the target, before the start of the helper's next turn
- [ ] If missing, implement the `ActiveEffect` creation

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? — Flee/surrender adds new combat end states but doesn't change existing elimination flow
- [x] Does the pending action state machine still have valid transitions? — Not affected
- [x] Is action economy preserved? — Flee costs an action (Disengage) + movement
- [ ] Do both player AND AI paths handle the change? — AI morale system (Phase 7) feeds into flee decisions
- [x] Are repo interfaces + memory-repos updated if entity shapes change? — `fled` status stored in combatant resources
- [x] Is `app.ts` registration updated if adding executors? — No new executors
- [x] Are D&D 5e 2024 rules correct? — Flee is not a formal D&D action but is a common table resolution

## Risks
- **"Map exit"** concept doesn't exist — need to define what constitutes "leaving the battlefield." Simplest: any creature that moves off the map edge or to a designated exit tile.
- **Surrender** is mostly narrative — the mechanics are just "combat ends." Keep it simple.

## Test Plan
- [ ] Unit test: all enemies fled → combat ends with "flee" result
- [ ] Unit test: manual combat end via API → combat ends with "dm_end" result
- [ ] Unit test: Help action creates advantage ActiveEffect on ally's next attack
- [ ] Unit test: Help advantage is consumed after one use
- [ ] E2E scenario: flee-combat.json — enemy flees and combat ends
- [ ] E2E scenario: manual-combat-end.json — DM manually ends combat
