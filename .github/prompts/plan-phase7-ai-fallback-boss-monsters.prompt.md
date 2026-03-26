# Plan: Phase 7 — Deterministic AI Fallback & Boss Monster Support
## Round: 1
## Status: COMPLETE
## Affected Flows: AIBehavior, CombatOrchestration

## Objective
Fix the 2 critical AI gaps: (1) build a robust deterministic fallback AI that plays a reasonable turn when LLM is unavailable or fails, and (2) add legendary action and lair action support for boss monsters. Currently, LLM failure means the AI does almost nothing (single attack, no movement).

## Changes

### AIBehavior — Deterministic Fallback AI

#### [File: application/services/combat/ai/deterministic-ai.ts — NEW]
- [x] `DeterministicAiDecisionMaker` implemented with full heuristic turn:
  1. **Stand up from Prone** if prone
  2. **Evaluate threats**: compute threat scores via `ai-target-scorer.ts`
  3. **Target selection**: focus fire lowest-HP, concentration caster, or nearest enemy
  4. **Movement**: A* path to reach preferred target
  5. **Action**: Attack preferred target (uses all Extra Attacks)
  6. **Bonus Action**: Use available bonus actions
  7. **Post-action movement**: Move away from threats if possible
- [x] Handles all creature types, respects action economy, spell slots, resource pools

#### [File: application/services/combat/ai/ai-turn-orchestrator.ts]
- [x] Uses `deterministicAi` when LLM unavailable
- [x] Falls back mid-turn when LLM returns null for remaining actions
- [x] `useDeterministicFallback` behavior integrated

#### [File: application/services/combat/ai/ai-target-scorer.ts — NEW]
- [x] `scoreTargets()` exported with scoring based on: HP ratio, AC, conditions, distance, concentration
- [x] Used by both deterministic AI and LLM context

### AIBehavior — Battle Plan Fallback

#### [File: application/services/combat/ai/battle-plan-service.ts]
- [x] When LLM is unavailable, generate a deterministic battle plan:
  - Default priority: `offensive` for monsters with CR ≥ 1, `defensive` for lower CR
  - Focus target: lowest-HP living enemy
  - Retreat condition: below 25% HP and outnumbered

### AIBehavior — Legendary Actions

#### [File: domain/entities/creatures/monster.ts]
- [x] Legendary traits defined in `legendary-actions.ts` — `LegendaryActionDef`, `LairActionDef`, `LegendaryTraits` parsed from stat block JSON
- [x] Charges tracked in combatant resources (initialized at combat start)
- [x] Charges reset at start of boss's turn

#### [File: application/services/combat/combat-service.ts]
- [x] After each non-boss turn, `processLegendaryActionsAfterTurn()` checks for charges and executes via AI
- [x] At boss's own turn start, `resetLegendaryActions()` called
- [x] Lair actions initialized in resources at combat start
- [x] D&D 2024: "Immediately after another creature's turn"

#### [File: application/services/combat/ai/handlers/ — legendary-action-handler.ts — NEW]
- [x] `chooseLegendaryAction()` with heuristic-based decisions and tests
- [x] Spreads actions across round, prioritizes attacks on vulnerable targets

### AIBehavior — Lair Actions

#### [File: domain/entities/creatures/monster.ts — lair]
- [x] `LairActionDef` defined in `legendary-actions.ts`
- [x] Lair actions occur on initiative count 20 via `processLairActionsIfNeeded()` with round tracking

#### [File: application/services/combat/combat-service.ts — lair]
- [x] Lair action "turn" at initiative count 20 via `processLairActionsIfNeeded()`
- [x] One lair action per round via AI decision

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? — Legendary actions execute outside pending action flow
- [x] Does the pending action state machine still have valid transitions? — Yes, legendary actions don't use pending actions
- [x] Is action economy preserved? — Legendary actions have their own economy (3 charges)
- [x] Do both player AND AI paths handle the change? — AI-only for v1 (boss monsters are AI-controlled)
- [x] Are repo interfaces + memory-repos updated if entity shapes change? — Resources JSON fields only
- [x] Is `app.ts` registration updated if adding executors? — No new ability executors, but legendary action handler registered
- [x] Are D&D 5e 2024 rules correct? — Verified legendary/lair action rules in 2024 DMG

## Risks
- **Deterministic AI quality**: Must be "good enough" — not optimal but not stupid. Focus on melee/ranged basics first, add spell intelligence later.
- **Legendary actions between turns**: This changes the fundamental turn loop. Must be carefully integrated with the combat-service nextTurn flow.
- **Testing legendary actions**: Complex multi-creature turn interactions — need thorough E2E scenarios.

## Test Plan
- [x] Unit test: deterministic AI moves to nearest enemy and attacks (in `deterministic-ai.test.ts`)
- [x] Unit test: deterministic AI uses bonus action
- [x] Unit test: deterministic AI retreats when low HP
- [x] Unit test: deterministic AI handles ranged positioning
- [x] Unit test: target scorer ranks concentration caster highest (in `ai-target-scorer.ts`)
- [x] Unit test: target scorer ranks low-HP enemies higher
- [x] Unit test: legendary actions reset at boss's turn start (in `resource-utils-legendary.test.ts`)
- [x] Unit test: legendary action costs 1-3 charges correctly
- [x] Unit test: lair action executes at initiative count 20
- [x] E2E scenario: deterministic-ai-fallback.json — AI plays full turn without LLM
- [x] E2E scenario: legendary-actions.json — boss uses legendary actions between turns
- [x] E2E scenario: lair-actions.json — lair action triggers at init 20
