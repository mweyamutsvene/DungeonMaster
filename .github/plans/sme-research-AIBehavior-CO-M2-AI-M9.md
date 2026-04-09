# SME Research — AIBehavior — CO-M2 + AI-M9

## CO-M2: Legendary Actions Between Turns

### Current State: Already Partially Implemented

Significant legendary action infrastructure already exists:

**`legendary-action-handler.ts`** — Pure deterministic decision function `chooseLegendaryAction()` that evaluates boss state, heuristically spreads actions across the round, and returns a `LegendaryActionDecision` (or null). Has unit tests. Uses `resource-utils.ts` helpers for charge tracking.

**`ai-turn-orchestrator.ts`** — Three key integration points:
1. `processAllMonsterTurns()` (line ~703) — calls `processLegendaryActionsAfterTurn()` both before the AI loop starts (for the just-ended combatant) and after each AI turn completes.
2. `processLegendaryActionsAfterTurn()` (line ~757) — finds all legendary bosses (not the one whose turn just ended), calls `chooseLegendaryAction()` for each, spends charges via `spendLegendaryActionCharges()`, emits `LegendaryAction` + `NarrativeText` events, and calls `executeLegendaryAttack()` for attack decisions.
3. `executeLegendaryAttack()` (line ~856) — Full attack resolution with ActiveEffects (advantage/disadvantage), condition-based roll mode, damage defenses, KO handling, rage damage tracking. Does NOT consume action economy.

**`resource-utils.ts`** — Complete legendary charge API: `getLegendaryActionsRemaining()`, `getLegendaryActionCharges()`, `getLegendaryActionDefs()`, `spendLegendaryAction()`, `resetLegendaryActions()`, `isLegendaryCreature()`.

### Gaps in Current Implementation

1. **Move legendary actions are narrative-only** — `processLegendaryActionsAfterTurn()` line ~830 comment: "Move and special actions emit narrative only for v1". Only attack-type legendary actions actually execute mechanically.
2. **Special legendary actions not implemented** — Same gap. A boss with a legendary "Frightful Presence" or "Tail Attack" that isn't a simple attack has no mechanical resolution path.
3. **No LLM involvement** — `chooseLegendaryAction()` is purely deterministic heuristics. It doesn't consult `IAiDecisionMaker`. For complex legendary creatures, an LLM could make better tactical calls.
4. **`AiDecision` type lacks legendary action variant** — The `AiDecision.action` union type does NOT include "legendaryAttack" or "legendaryAction". If LLM-driven legendary actions are wanted, the decision type or a separate interface would need extension.
5. **AiActionExecutor/Registry uninvolved** — Legendary actions bypass the handler registry entirely. `executeLegendaryAttack()` duplicates ~120 lines of `AiAttackResolver.resolve()` logic (d20, advantage/disadvantage, damage, defenses, KO).
6. **Two-phase reactions not invoked** — Legendary attacks skip the reaction system. A target with Shield or Deflect Attacks cannot react. This is a rules violation.
7. **Charge reset timing** — `resetLegendaryActions()` exists but needs verification that it's called at the start of the boss's own turn in `combat-service.ts` or `extractActionEconomy()`.

### Dependencies That Could Break (CO-M2)
- `AiAttackResolver` changes must be mirrored in `executeLegendaryAttack()` (or unified)
- Two-phase integration would require `TwoPhaseActionService` awareness of legendary action context
- Event system expectations (`LegendaryAction` event type) in tests/transcripts

---

## AI-M9: Token/Context Limit Awareness for LLM Payloads

### Current State: ZERO size awareness

**`AiContextBuilder.build()`** (line ~842) assembles `AiCombatContext` with these sections:

| Section | Size Risk |
|---------|-----------|
| `combatant` (self) | **HIGH** — includes raw traits[], attacks[], actions[], bonusActions[], reactions[], spells[], abilities[], features[] arrays from stat block. Can be huge for complex monsters. |
| `allies[]` | Scales with ally count. Each: name, HP, conditions, position, AC, speed, knownAbilities[], damage defenses, deathSaves, concentrationSpell. |
| `enemies[]` | Same as allies + spellSaveDC, coverFromMe. |
| `battlefield` | Grid is `width × height` chars. Large maps (30×30+) produce very large grids. |
| `zones` | One entry per active zone with effects array. |
| `recentNarrative` | Bounded at 10 entries — reasonable. |
| `actionHistory` | Max 5 entries (maxIterations) — small. |
| `turnResults` | Max 5, but each has summary + data object. |
| `battlePlan` | Small — 5 string fields. |

### Serialization Path

In `LlmAiDecisionMaker.decide()` (ai-decision-maker.ts line ~80):
```typescript
const { battlefield: _bf, ...contextWithoutBattlefield } = input.context;
.addSection('combat-state', 'Current combat state:\n' + JSON.stringify(contextWithoutBattlefield, null, 2));
```
The **entire AiCombatContext** (minus battlefield, rendered separately as ASCII) gets pretty-printed JSON into the user message. The system prompt alone is ~350 lines / ~12K chars (~3-4K tokens). No truncation anywhere.

### No Token Estimation Exists
- `PromptBuilder` has NO token counting, truncation, or size awareness.
- No `estimateTokens()`, `maxContextTokens`, or similar in the codebase.
- No LLM provider exposes model context window size.
- `LlmProvider.chat()` accepts `timeoutMs` but no input token limit.

### Truncation Priority (highest savings first)
1. **Monster stat block raw arrays** (traits, abilities, features, spells) — often 20+ verbose entries
2. **Battlefield grid** — can crop to viewport around AI combatant
3. **Pretty-print whitespace** — `JSON.stringify(ctx, null, 2)` wastes ~30% tokens vs compact
4. **Ally/enemy arrays** — for 8+ combatant battles, limit to closest N or omit low-relevance fields
5. **recentNarrative** — reduce from 10 to 5 for large contexts
6. **turnResults data objects** — trim verbose data payloads

### Recommended Architecture
1. Add `estimateTokens(text: string): number` — `Math.ceil(text.length / 4)` heuristic
2. Add `maxContextTokens` to LlmProvider config (model-specific: 8K for small Ollama, 128K for GPT-4)
3. Add `ContextBudgetManager` in `infrastructure/llm/` — truncates AiCombatContext to fit budget
4. Apply in `LlmAiDecisionMaker.decide()` after context build, before serialization
5. Same pattern for `LlmBattlePlanner` which also serializes full context

### Critical: Deterministic AI Must Not Be Affected
`DeterministicAiDecisionMaker` reads `AiCombatContext` directly (not serialized). Truncation must only affect the serialized version sent to LLM, not the in-memory object.

### Affected Files

| File | Why |
|------|-----|
| `ai-context-builder.ts` | Builds full context; may need truncation hints |
| `infrastructure/llm/ai-decision-maker.ts` | Serializes context to prompt — truncation point |
| `infrastructure/llm/prompt-builder.ts` | Could add token estimation/budget methods |
| `infrastructure/llm/battle-planner.ts` | Also serializes combat state, needs same treatment |
| `infrastructure/llm/types.ts` | LlmProvider config might need maxContextTokens |
| `ai-types.ts` (AiCombatContext) | Interface unchanged but truncation clones it |
| `infrastructure/llm/spy-provider.ts` | Snapshots will need `test:llm:e2e:snapshot-update` |

### Risks
- **Snapshot tests** — any prompt format change invalidates stored snapshots
- **LLM accuracy regression** — truncating context may degrade decision quality; validate with `test:llm:e2e:ai`
- **Battle planner** uses its own serialization path (not `AiCombatContext`) — needs parallel treatment
