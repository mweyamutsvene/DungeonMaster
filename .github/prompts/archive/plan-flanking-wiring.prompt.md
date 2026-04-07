# Plan: Wire Flanking into Attack Resolution Pipeline
## Round: 1
## Status: IN_PROGRESS
## Affected Flows: CombatRules, CombatOrchestration, AIBehavior

## Objective
Wire the existing `checkFlanking()` domain function into the actual attack resolution pipeline. Flanking is a D&D 5e 2024 optional rule — when enabled on an encounter, melee attackers with an ally on the opposite side of a target gain advantage. Need to add a `flankingEnabled` toggle, wire into both tabletop and AI attack paths, surface in tactical view, and add AI awareness.

## Changes

### CombatRules
#### [File: domain/rules/combat-map-types.ts]
- [x] Add `flankingEnabled?: boolean` to `CombatMap` interface (opt-in encounter config)

### CombatOrchestration — Tabletop Attack Path
#### [File: application/services/combat/tabletop/dispatch/attack-handlers.ts]
- [x] Add `encounterId` param to `computeAttackRollModifiers`
- [x] In `computeAttackRollModifiers`, if encounter has `flankingEnabled` and attack is melee, call `checkFlanking()` with attacker pos, target pos, and all allied combatant positions
- [x] If flanking detected, increment `extraAdvantage`

### CombatOrchestration — AI Attack Path
#### [File: application/services/combat/ai/ai-attack-resolver.ts]
- [x] Same flanking check — read encounter mapData, if flankingEnabled and melee, check flanking
- [x] Increment effectAdvantage if flanking

### CombatOrchestration — Tactical View
#### [File: application/services/combat/tactical-view-service.ts]
- [x] Add `flankingEnabled` and per-combatant `isFlanking` / `flankingTargets` to TacticalView
- [x] Calculate which combatants are currently in a flanking position

### Infrastructure — API Endpoint
#### [File: infrastructure/api/routes/sessions/session-combat.ts]
- [x] Add `PATCH /sessions/:id/combat/flanking` endpoint to toggle flankingEnabled

### Infrastructure — Scenario Runner
#### [File: scripts/test-harness/scenario-runner.ts]
- [x] Add `flankingEnabled?: boolean` to `ScenarioSetup`
- [x] Wire into scenario startup to PATCH flanking after combat start

### Domain — Remove TODO
#### [File: domain/combat/attack-resolver.ts]
- [x] Remove the flanking TODO comment (it's now wired)

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? No — flanking is additive (adds advantage source)
- [x] Does the pending action state machine still have valid transitions? Yes — no changes
- [x] Is action economy preserved? Yes — no changes to action economy
- [x] Do both player AND AI paths handle the change? Yes — both attack-handlers.ts and ai-attack-resolver.ts updated
- [x] Are repo interfaces + memory-repos updated if entity shapes change? No shape changes — flankingEnabled stored in existing mapData JSON
- [x] Is `app.ts` registration updated if adding executors? N/A
- [x] Are D&D 5e 2024 rules correct? Yes — flanking gives advantage on melee attacks when ally on opposite side

## Risks
- Flanking check needs ally positions filtered by faction. Must match attacker's faction (allies only).
- AI should not count dead/incapacitated allies for flanking.
- Performance: flanking check per attack is O(allies) — acceptable for combat sizes.

## Test Plan
- [x] E2E scenario: flanking/flanking-advantage — tests flanking advantage on melee attacks
- [x] Unit tests: existing flanking.test.ts covers isFlanking/checkFlanking domain logic

## SME Approval (skipped — Tier 2 lean)
