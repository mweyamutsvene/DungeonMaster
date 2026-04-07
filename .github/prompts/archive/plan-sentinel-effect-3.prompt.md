# Plan: Sentinel Feat Effect #3 — Reaction Attack When Ally Attacked
## Round: 1
## Status: APPROVED
## Affected Flows: CombatRules, CombatOrchestration

## Objective
Implement the third Sentinel feat effect: when a creature within 5 feet of the Sentinel makes an attack roll against a target other than the Sentinel, the Sentinel can use their reaction to make a melee weapon attack against the attacking creature. Effects #1 (OA ignores Disengage) and #2 (OA hit reduces speed to 0) are already implemented.

## D&D 5e 2024 Rules
- **Trigger**: A creature within 5 feet of you makes an attack roll against a target other than you
- **Cost**: Your reaction
- **Effect**: Make one melee weapon attack against the attacking creature
- The Sentinel must be within 5 feet of the ATTACKER (not the target)
- This is a melee weapon attack

## Changes

### CombatRules Flow
#### [File: domain/rules/opportunity-attack.ts]
- [x] Add `SentinelReactionTrigger` interface for Sentinel reaction eligibility checking
- [x] Add `canMakeSentinelReaction()` pure function — checks: hasSentinel, hasReaction, notIncapacitated, within5ft, notTheTarget

#### [File: domain/entities/combat/pending-action.ts]
- [x] Add `"sentinel_attack"` to the `ReactionType` union

### CombatOrchestration Flow
#### [File: application/services/combat/two-phase/attack-reaction-handler.ts]
- [x] In `initiate()`: After existing Shield/Deflect detection, scan ALL combatants for Sentinel eligibility (within 5ft of attacker, not the target, hasReaction, sentinelEnabled on resources)
- [x] Add Sentinel reaction opportunities to the `reactionOpportunities` array with type `"sentinel_attack"`
- [x] In `complete()`: When a Sentinel reaction is used, resolve a melee weapon attack against the original attacker (similar to OA resolution — use dice roller, apply damage)

#### [File: infrastructure/api/routes/reactions.ts]
- [x] Add `"sentinel_attack"` to the reaction label mapping for clear messaging

### Testing
#### [File: scripts/test-harness/scenarios/core/sentinel-reaction.json]
- [x] E2E scenario: 2 characters + 1 monster; monster attacks character A, character B (Sentinel, within 5ft) uses reaction to attack monster

#### [File: domain/rules/opportunity-attack.test.ts]
- [x] Unit tests for `canMakeSentinelReaction()` (eligible, no reaction, too far, is target, incapacitated, no sentinel feat)

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? — No, additive changes only
- [x] Does the pending action state machine still have valid transitions? — Yes, uses existing attack pending action type
- [x] Is action economy preserved (1 action, 1 bonus, 1 reaction, 1 movement)? — Yes, Sentinel reaction consumes the reaction for the round
- [x] Do both player AND AI paths handle the change? — Yes, initiateAttack() is called from AI path; tabletop path will also inherit when AI attacks player
- [x] Are repo interfaces + memory-repos updated if entity shapes change? — No entity shape changes
- [x] Is `app.ts` registration updated if adding executors? — No new executors
- [x] Are D&D 5e 2024 rules correct (not 2014)? — Yes

## Risks
- Sentinel reaction during attack initiation adds a new reaction opportunity alongside Shield/Deflect. The reaction endpoint already handles multiple reaction types per pending action, so this should work.
- The Sentinel attack resolution in `completeAttack()` needs dice rolling. We reuse the same seeded dice approach as OA resolution.

## Test Plan
- [x] Unit tests for `canMakeSentinelReaction()` in `opportunity-attack.test.ts`
- [x] E2E scenario `core/sentinel-reaction.json` covering happy path (Sentinel reacts to ally being attacked)
