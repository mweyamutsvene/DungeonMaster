# Plan: Phase 7 — Deterministic AI Fallback & Boss Monster Support
## Round: 1
## Status: DRAFT
## Affected Flows: AIBehavior, CombatOrchestration

## Objective
Fix the 2 critical AI gaps: (1) build a robust deterministic fallback AI that plays a reasonable turn when LLM is unavailable or fails, and (2) add legendary action and lair action support for boss monsters. Currently, LLM failure means the AI does almost nothing (single attack, no movement).

## Changes

### AIBehavior — Deterministic Fallback AI

#### [File: application/services/combat/ai/deterministic-ai.ts — NEW]
- [ ] Create `DeterministicAiDecisionMaker` implementing `IAiDecisionMaker`
- [ ] Heuristic-based decision engine that executes a full turn:
  1. **Stand up from Prone** if prone (before any other action)
  2. **Evaluate threats**: compute threat scores for each enemy (HP, AC, damage potential, conditions)
  3. **Target selection**: focus fire lowest-HP enemy within reach, or concentration caster, or nearest enemy
  4. **Movement**: A* path to reach preferred target. If ranged, maintain range. If melee, close distance
  5. **Action**: Attack preferred target (use all Extra Attacks). If no target in range, Dash to close. If spellcaster, cast highest-value offensive spell
  6. **Bonus Action**: Use available bonus actions (Flurry of Blows if ki > 0, Healing Word if ally dying, etc.)
  7. **Post-action movement**: If movement remaining and in danger, move away from threats
- [ ] Should handle all creature types (Monster, NPC, Character)
- [ ] Must respect action economy, spell slots, resource pools

#### [File: application/services/combat/ai/ai-turn-orchestrator.ts]
- [ ] Replace `fallbackSimpleTurn()` with `DeterministicAiDecisionMaker`
- [ ] When LLM returns null mid-turn, fall back to deterministic AI for remaining actions instead of ending turn
- [ ] Add `useDeterministicFallback` option to orchestrator deps

#### [File: application/services/combat/ai/ai-target-scorer.ts — NEW]
- [ ] Create target scoring utility used by both deterministic AI and LLM context
- [ ] Score based on: remaining HP ratio, AC (lower = easier), threatening abilities, conditions (stunned = advantage), distance (closer = cheaper), concentration (break it = high value)
- [ ] Export `scoreTargets(self, enemies, combat)` returning scored/sorted target list

### AIBehavior — Battle Plan Fallback

#### [File: application/services/combat/ai/battle-plan-service.ts]
- [ ] When LLM is unavailable, generate a deterministic battle plan:
  - Default priority: `offensive` for monsters with CR ≥ party level, `defensive` for lower CR
  - Focus target: highest-threat party member (by damage dealt or lowest AC)
  - Retreat condition: below 25% HP and outnumbered

### AIBehavior — Legendary Actions

#### [File: domain/entities/creatures/monster.ts]
- [ ] Add `legendaryActions?: LegendaryActionDef[]` field with: name, cost (1-3), action definition
- [ ] Add `legendaryActionCharges: number` (usually 3) and `legendaryActionChargesUsed: number`
- [ ] Charges reset at start of the boss's turn

#### [File: application/services/combat/combat-service.ts]
- [ ] After EACH non-boss combatant's turn ends, check if any boss monster has legendary action charges remaining
- [ ] If so, create a legendary action opportunity — either AI decides or prompt player (for player-controlled bosses)
- [ ] Execute the legendary action between turns
- [ ] D&D 2024: "Immediately after another creature's turn, the [boss] can spend legendary actions"

#### [File: application/services/combat/ai/handlers/ — legendary-action-handler.ts — NEW]
- [ ] AI handler for choosing which legendary action to take
- [ ] Heuristic: use legendary actions spread across the round (don't dump all at once)
- [ ] Prioritize: movement to reposition, attacks on vulnerable targets, special abilities

### AIBehavior — Lair Actions

#### [File: domain/entities/creatures/monster.ts]
- [ ] Add optional `lairActions?: LairActionDef[]` field
- [ ] Lair actions occur on initiative count 20 (losing ties)

#### [File: application/services/combat/combat-service.ts]
- [ ] Insert a "lair action turn" at initiative count 20 if any monster has lair actions
- [ ] Execute one lair action per round via AI decision

## Cross-Flow Risk Checklist
- [ ] Do changes in one flow break assumptions in another? — Legendary actions between turns add new turn-like processing slots
- [ ] Does the pending action state machine still have valid transitions? — Legendary actions may need their own pending action state
- [x] Is action economy preserved? — Legendary actions have their own economy (3 charges)
- [ ] Do both player AND AI paths handle the change? — Primary concern is AI path; player-controlled bosses are rare
- [ ] Are repo interfaces + memory-repos updated if entity shapes change? — legendaryActionCharges in combatant resources
- [x] Is `app.ts` registration updated if adding executors? — No new ability executors, but legendary action handler registered
- [x] Are D&D 5e 2024 rules correct? — Verified legendary/lair action rules in 2024 DMG

## Risks
- **Deterministic AI quality**: Must be "good enough" — not optimal but not stupid. Focus on melee/ranged basics first, add spell intelligence later.
- **Legendary actions between turns**: This changes the fundamental turn loop. Must be carefully integrated with the combat-service nextTurn flow.
- **Testing legendary actions**: Complex multi-creature turn interactions — need thorough E2E scenarios.

## Test Plan
- [ ] Unit test: deterministic AI moves to nearest enemy and attacks
- [ ] Unit test: deterministic AI uses bonus action (Flurry, Cunning Action)
- [ ] Unit test: deterministic AI retreats when low HP and outnumbered
- [ ] Unit test: deterministic AI handles ranged attacker positioning
- [ ] Unit test: target scorer ranks concentration caster highest
- [ ] Unit test: target scorer ranks low-HP enemies higher
- [ ] Unit test: legendary actions reset at boss's turn start
- [ ] Unit test: legendary action costs 1-3 charges correctly
- [ ] Unit test: lair action executes at initiative count 20
- [ ] E2E scenario: deterministic-ai-fallback.json — AI plays full turn without LLM
- [ ] E2E scenario: legendary-actions.json — boss uses legendary actions between turns
- [ ] E2E scenario: lair-actions.json — lair action triggers at init 20
