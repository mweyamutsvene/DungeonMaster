# Plan: Medium-Tier Items (CO-M2, AI-M9, EM-M1)
## Round: 1
## Status: COMPLETED
## Affected Flows: CombatOrchestration, AIBehavior, EntityManagement, ClassAbilities

## Objective
Implement three medium-tier items: (1) CO-M2 legendary actions between turns — ALREADY IMPLEMENTED, closing, (2) AI-M9 token/context limit awareness for LLM payloads, (3) EM-M1 basic multiclassing support on Character entity.

---

## CO-M2: Legendary Actions Between Turns — ALREADY DONE ✅

Both CombatOrchestration-SME and AIBehavior-SME confirm this is fully implemented:
- `processLegendaryActionsAfterTurn()` in AiTurnOrchestrator runs after each creature's turn
- `chooseLegendaryAction()` in legendary-action-handler.ts handles heuristic decision
- `executeLegendaryAttack()` resolves attack legendary actions fully
- Charge reset at start of boss turn in `processIncomingCombatantEffects()`
- E2E scenario: `core/legendary-actions.json`

Minor gaps (future tickets, not in scope): move/special legendary actions are narrative-only, no LLM involvement, reactions not invoked for legendary attacks.

---

## AI-M9: Token/Context Limit Awareness

### Changes

#### [File: `infrastructure/llm/context-budget.ts`] (NEW)
- [x] Create `estimateTokens(text: string): number` — `Math.ceil(text.length / 4)` heuristic
- [x] Create `truncateContextForLlm(context: AiCombatContext, maxTokens?: number): AiCombatContext` that applies progressive truncation:
  1. Always: switch from pretty-print (null, 2) to compact JSON — done at serialization point
  2. If over budget: reduce stat block arrays (traits, abilities, features) to name-only summaries for the AI combatant
  3. If still over: limit ally/enemy arrays to closest N (by distance) and reduce detail (HP/AC/conditions only)
  4. If still over: limit recentNarrative to last 3 entries
  5. Add `_truncated?: string` note so LLM knows context was reduced
- [x] Default maxTokens: 6000 for context portion (configurable)

#### [File: `infrastructure/llm/ai-decision-maker.ts`]
- [x] Import and call `truncateContextForLlm()` before serialization
- [x] Switch JSON.stringify from `(ctx, null, 2)` to `(ctx, null, 0)` (compact) — actually just use default which is no spaces
- [x] Keep the in-memory `input.context` object unchanged (deterministic AI reads full context)

#### [File: `infrastructure/llm/prompt-builder.ts`]
- [x] Add `estimateTokens(): number` method that estimates total tokens across all sections

---

## EM-M1: Basic Multiclassing Support

### Changes

#### [File: `domain/entities/creatures/character.ts`]
- [x] Add `classLevels?: Array<{ classId: string; level: number; subclass?: string }>` to `CharacterData` interface
- [x] Add private `classLevels` field to Character class
- [x] Add `getClassLevels(): Array<{ classId: string; level: number; subclass?: string }>` method:
  - If `classLevels` is set and non-empty, return it
  - Otherwise derive: `[{ classId: this.classId ?? this.characterClass.toLowerCase(), level: this.level, subclass: this.subclass }]`
- [x] Add `getTotalLevel(): number` that sums classLevels (or returns this.level for single-class)
- [x] Update `toJSON()` to include classLevels when present
- [x] Update constructor to store classLevels from data

#### [File: `domain/entities/classes/combat-resource-builder.ts`]
- [x] Add `classLevels?: Array<{ classId: string; level: number; subclass?: string }>` to `CombatResourceBuilderInput`
- [x] When `classLevels` is provided, iterate each class entry and call `resourcesAtLevel()` for each, merging pools
- [x] When `classLevels` is absent, use existing single-class path (backward compat)
- [x] Avoid double-counting spell slots (they come from sheet, not class definitions)

#### [File: `application/services/entities/character-service.ts`]
- [x] Accept `classLevels` in the add-character input
- [x] Store in sheet JSON when provided

#### [File: `combat/helpers/creature-hydration.ts`]
- [x] Read `sheet.classLevels` during hydration and populate CharacterData.classLevels

#### [File: `combat/tabletop/rolls/initiative-handler.ts`]
- [x] Pass classLevels to CombatResourceBuilder when building combat resources

---

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? No — AI-M9 only affects LLM serialization, EM-M1 is additive with backward compat
- [x] Does the pending action state machine still have valid transitions? Unchanged
- [x] Is action economy preserved? Unchanged
- [x] Do both player AND AI paths handle the change? AI-M9 only affects LLM path; EM-M1 is entity-level
- [x] Are repo interfaces + memory-repos updated if entity shapes change? No schema change — classLevels stored in sheet JSON
- [x] Is `app.ts` registration updated if adding executors? N/A
- [x] Are D&D 5e 2024 rules correct? Yes — multiclass class levels tracked separately, total level for proficiency

## Risks
- **AI-M9**: Prompt truncation could degrade LLM decision quality. Mitigation: conservative defaults, only truncate when genuinely large, keep critical info (self, primary target) at full detail.
- **EM-M1**: 13+ call sites read single `className`. Mitigation: `getClassLevels()` is additive; single-class callers continue using existing getters. Migration of callers to multi-class-aware paths is a future phase.

## Test Plan
- [x] Unit test: `context-budget.test.ts` — estimateTokens, truncation thresholds, progressive truncation behavior (7 tests)
- [x] Unit test: character.test.ts — getClassLevels() single-class derivation, multi-class with classLevels set, getTotalLevel() (7 tests)
- [x] Unit test: combat-resource-builder with classLevels input (3 tests)
- [x] E2E: all 181 existing scenarios remain green (backward compat)
