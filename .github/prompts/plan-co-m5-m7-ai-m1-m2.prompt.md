# Plan: CO-M5 + CO-M7 + AI-M1 + AI-M2
## Round: 1
## Status: COMPLETE
## Affected Flows: CombatOrchestration, AIBehavior

## Objective
Four changes: two pure refactors (CO-M5, CO-M7) and two AI improvements (AI-M1, AI-M2).

## Changes

### CombatOrchestration

#### CO-M5: Cache combatants in DamageResolver + RollStateMachine
- [x] Add optional `combatantsCache` parameter to `DamageResolver.resolve()`
- [x] At the start of `resolve()`, load combatants once and reuse throughout
- [x] Replace 11 `listCombatants()` calls in `damage-resolver.ts` with cache hits
- [x] In `handleAttackRoll()`, load combatants once and pass to sub-operations (12 calls → 1-2)
- [x] Falls back to fresh load if cache is null (defensive)

#### CO-M7: Decompose CombatService.nextTurn()
- [x] Extract `processEndOfTurnEffects()` — condition expiry, ActiveEffect cleanup, zone triggers
- [x] Extract `processStartOfTurnEffects()` — condition expiry, StunningStrikePartial, ActiveEffect start-of-turn, zone triggers
- [x] Extract `advanceTurnOrder()` — combat.endTurn(), skip defeated non-characters, persist round/turn
- [x] Extract `processIncomingCombatantEffects()` — rage end check, legendary action reset, action economy
- [x] Extract `processDeathSaveIfNeeded()` — auto death save logic
- [x] `nextTurn()` becomes thin orchestrator calling these in sequence

### AIBehavior

#### AI-M1: Bonus-action spell + action spell coordination
- [x] Add `pickBonusActionSpell()` function that selects BA spells (Healing Word, Spiritual Weapon)
- [x] When a BA leveled spell is picked, restrict main action to cantrips or non-spell actions
- [x] When a leveled main action spell is picked, restrict bonus action spells to cantrips only
- [x] Integrate with existing pickSpell() and pickBonusAction() flow

#### AI-M2: AoE spell evaluation
- [x] Add `estimateAoETargets()` function that counts enemies in estimated AoE area
- [x] Parse `area` and `zone` fields from spell definitions for shape + size
- [x] Weight AoE spell value = single-target damage × estimated targets hit
- [x] Add AoE spell selection path in `pickFromCandidates()` (prefer AoE when 3+ enemies clustered)

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? — No, independent changes
- [x] Does the pending action state machine still have valid transitions? — Unchanged
- [x] Is action economy preserved? — CO-M5/M7 are behavior-preserving; AI-M1 enforces correct economy
- [x] Do both player AND AI paths handle the change? — CO-M5/M7 affect player path; AI-M1/M2 affect AI path
- [x] Are repo interfaces + memory-repos updated if entity shapes change? — No shape changes
- [x] Is `app.ts` registration updated if adding executors? — No new executors
- [x] Are D&D 5e 2024 rules correct? — AI-M1 enforces 2024 BA spell + action cantrip rule

## Risks
- CO-M5: Stale cache if mid-resolution mutations (mitigated: re-fetch after mutations)
- CO-M7: Incorrect extraction boundaries (mitigated: behavior-preserving, run full test suite)
- AI-M1: Edge cases with multi-class casters (mitigated: simple level > 0 check)
- AI-M2: Position data may be missing (mitigated: fallback to single-target evaluation)

## Test Plan
- [x] Run existing test suite to verify no regressions (CO-M5, CO-M7 are pure refactors)
- [x] Run E2E scenarios to verify AI behavior still works (AI-M1, AI-M2 are additive)
