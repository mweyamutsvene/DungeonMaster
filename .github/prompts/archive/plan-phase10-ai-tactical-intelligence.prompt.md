# Plan: Phase 10 — AI Tactical Intelligence & Class Feature Usage
## Round: 1
## Status: DRAFT
## Affected Flows: AIBehavior

## Objective
Improve AI tactical decision-making by adding cover information to context, range maintenance for ranged attackers, AoE spell optimization hints, and ensuring AI creatures use their class features (Action Surge, Rage, Divine Smite, Sneak Attack positioning). These are "Important" severity items that make AI play noticeably better.

## Changes

### AIBehavior — Cover in Tactical Context

#### [File: application/services/combat/ai/tactical-context-builder.ts]
- [x] Add cover information to enemy/ally context: for each enemy, compute cover level from the AI creature's position
- [x] Add `coverFromMe` field: "none" | "half" | "three-quarters" | "full" to each enemy entry
- [ ] Add nearby cover positions: cells within movement range that provide cover from priority threats
- [ ] Add `coverPositions?: { position, coversFrom: enemyId[] }[]` to self context

### AIBehavior — Range Maintenance for Ranged Attackers

#### [File: infrastructure/llm/ai-decision-maker.ts or tactical-context-builder.ts]
- [ ] Add `optimalRange` field to self context based on equipped weapon/spell range
- [ ] For ranged attackers: identify the "sweet spot" (e.g., 25-30ft for shortbow, 50-60ft for longbow)
- [ ] Add `isInOptimalRange` boolean to each enemy entry
- [ ] Add prompt guidance: "Ranged attackers should maintain optimal range — don't enter melee unless forced"

### AIBehavior — AoE Spell Optimization

#### [File: application/services/combat/ai/tactical-context-builder.ts]
- [ ] For spellcasters with AoE spells, pre-compute AoE value: "if you cast Fireball at position X, it hits N enemies and M allies"
- [ ] Add `aoeOpportunities?: { spellName, position, enemiesHit, alliesHit }[]` to self context
- [ ] Only compute for top 2-3 AoE spells to avoid context bloat

### AIBehavior — AI Class Feature Usage

#### [File: infrastructure/llm/ai-decision-maker.ts]
- [x] Add specific prompt sections for key class features:
  - **Action Surge** (Fighter): "If you haven't used Action Surge this combat and multiple enemies are in range, consider using it for a double-action turn"
  - **Rage** (Barbarian): "If you're not raging and entering melee combat, use Rage on your first turn"
  - **Divine Smite** (Paladin): "On a critical hit or against a high-priority target, use Divine Smite for extra radiant damage"
  - **Sneak Attack** (Rogue): "You get Sneak Attack when you have advantage OR an ally is within 5ft of your target"
  - **Ki/Focus abilities** (Monk): "Use Flurry of Blows when engaged in melee, Patient Defense when surrounded"

#### [File: application/services/combat/ai/handlers/class-feature-handler.ts — NEW]
- [ ] Create handler that explicitly triggers class features based on heuristics when LLM is not available or forgets:
  - Auto-Rage for Barbarian on first melee turn
  - Suggest Action Surge when multiple attacks available
  - Auto-Sneak Attack on eligible hits (already automatic via RollStateMachine)

### AIBehavior — Monster Behavioral Archetypes

#### [File: domain/entities/creatures/monster.ts or ai/monster-behavior.ts — NEW]
- [ ] Define behavioral archetype enum: `aggressive`, `defensive`, `support`, `ranged`, `cowardly`, `berserker`, `ambusher`
- [ ] Map common monsters to archetypes:
  - Goblin → `cowardly` (flees at low HP, uses hit-and-run)
  - Skeleton → `aggressive` (attacks nearest, no retreat)
  - Zombie → `berserker` (attacks nearest, ignores tactics)
  - Wolf → `aggressive` + pack tactics
  - Orc → `aggressive` (charges strongest-looking target)
  - Kobold → `ambusher` (uses traps, hit-and-run)
  - Skeleton Archer → `ranged` (maintains distance)
- [ ] Include archetype in AI context for LLM personality guidance
- [ ] Deterministic AI uses archetype to choose between offensive/defensive/retreat behaviors

### AIBehavior — LLM Reaction Intelligence

#### [File: application/services/combat/ai/ai-turn-orchestrator.ts]
- [x] Improve `aiDecideReaction()` beyond simple heuristics:
  - Shield: only use if the attack would hit without Shield (check AC + 5 vs attack roll)
  - Counterspell: prioritize countering high-level spells and save-or-suck effects
  - OA: skip if the creature disengaging is not a threat (low HP ally moving away)
  - Absorb Elements: always use against elemental damage

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? — Context changes are additive
- [x] Does the pending action state machine still have valid transitions? — Not affected
- [x] Is action economy preserved? — Not affected (AI just decides better within existing economy)
- [x] Do both player AND AI paths handle the change? — Only AI path affected
- [x] Are repo interfaces + memory-repos updated if entity shapes change? — No entity changes
- [x] Is `app.ts` registration updated if adding executors? — No new ability executors
- [x] Are D&D 5e 2024 rules correct? — N/A (AI quality, not rules)

## Risks
- **Context bloat**: Adding cover positions, AoE opportunities, and range info could make the LLM prompt too long. Keep additions concise.
- **AoE computation cost**: Pre-computing AoE coverage for all spells × all positions is expensive. Limit to 3-5 candidate positions and 2-3 spells.
- **Behavioral archetypes**: Must not override player-visible rules — just change tactical preferences.

## Test Plan
- [x] Unit test: cover info appears in tactical context for enemies
- [ ] Unit test: ranged attacker gets optimalRange in context
- [ ] Unit test: AoE opportunities computed correctly (3 enemies in Fireball radius)
- [ ] Unit test: monster archetype appears in context
- [x] Unit test: Shield reaction only used when attack.total > AC (but ≤ AC+5)
- [ ] E2E scenario: ai-class-features.json — AI barbarian Rages, Fighter Action Surges
- [ ] E2E scenario: ai-ranged-positioning.json — ranged AI maintains distance
- [ ] E2E scenario: ai-monster-behavior.json — cowardly goblin flees at low HP
