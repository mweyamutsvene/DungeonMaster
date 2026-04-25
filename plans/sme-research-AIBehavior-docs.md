---
type: sme-research
flow: AIBehavior
feature: docs-accuracy
author: AIBehavior-SME
status: COMPLETE
round: 1
created: 2026-04-25
updated: 2026-04-25
---

# SME Research — AIBehavior — Docs Accuracy

## Scope
- Docs compared: `.github/instructions/ai-behavior.instructions.md`, `packages/game-server/src/application/services/combat/ai/CLAUDE.md`, `packages/game-server/src/infrastructure/llm/CLAUDE.md`
- Code verified: `ai-turn-orchestrator.ts`, `ai-context-builder.ts`, `ai-action-executor.ts`, `ai-types.ts`, `battle-plan-service.ts`, `battle-plan-types.ts`, `infrastructure/llm/{factory,types,index,ai-decision-maker,battle-planner,intent-parser,narrative-generator,spy-provider}.ts`, plus `infrastructure/llm/mocks/index.ts`
- Adjacent checks used: orchestrator gating/fallback, context payload shape, provider factory selection, battle-plan contract, prompt/truncation utilities, mock/spy helpers

## Current Truth
- The flow still centers on `AiTurnOrchestrator`, `AiContextBuilder`, `AiActionExecutor`, `BattlePlanService`, and infrastructure LLM adapters.
- LLM remains optional, but the concrete fallback behavior is stronger than the docs say today:
  - `AiTurnOrchestrator` uses `aiDecisionMaker ?? deterministicAi`
  - if the configured LLM decision maker returns `null`, the same turn step falls back to `DeterministicAiDecisionMaker`
  - `BattlePlanService` likewise falls back to a deterministic plan when no planner exists or the planner returns `null`
- Provider selection is driven by `DM_LLM_PROVIDER`, not by one model env var. Current supported backends are `ollama`, `openai`, `github-models`, and `copilot`.
- `IAiBattlePlanner` currently exposes `generatePlan(...)`, and `LlmBattlePlanner` implements that contract.
- `AiCombatContext` has grown beyond the older potion boolean model. Current important fields include `canUseItems`, `usableItems`, `bestBonusHealSpellEV`, `lastActionResult`, optional `battlePlan`, and optional `mapData`. `hasPotions` still exists, but is explicitly deprecated for compatibility.
- `LlmAiDecisionMaker` now applies `truncateContextForLlm(...)` before prompt serialization and can switch to a compact prompt mode for smaller models.
- `SpyLlmProvider` is present and does capture prompt/response calls for snapshot-style assertions.

## Drift Findings
1. `.github/instructions/ai-behavior.instructions.md` is stale on backend coverage.
   - It describes `LlmProvider` as the unified adapter for Ollama/OpenAI/GitHub Models only.
   - Current source also exports and factory-selects `CopilotProvider`.

2. `.github/instructions/ai-behavior.instructions.md` has a stale battle-planner contract name in the Mermaid diagram.
   - Diagram shows `IAiBattlePlanner.createBattlePlan()`.
   - Current interface method is `generatePlan()`.

3. `.github/instructions/ai-behavior.instructions.md` understates the real fallback path.
   - The doc says LLM is optional and the system degrades gracefully.
   - Current source does not just “gracefully degrade”; it explicitly falls back to deterministic AI for turn decisions and deterministic battle plans when LLM pieces are absent or return `null`.

4. `.github/instructions/ai-behavior.instructions.md` is missing newer context-shape guidance.
   - It still frames item use mostly around `hasPotions`.
   - Current context uses `canUseItems`, `usableItems`, and `bestBonusHealSpellEV`, with `hasPotions` retained only for backward-compatible prompt snapshots.
   - `lastActionResult` and optional `mapData` are also relevant current fields not called out.

5. `.github/instructions/ai-behavior.instructions.md` is missing current prompt-budget behavior.
   - The current LLM decision path truncates oversized context and can use a compact system prompt for smaller models.
   - That is a real behavior in the shipped decision-maker, not an implementation detail that can be ignored.

6. `.github/instructions/ai-behavior.instructions.md` is slightly misleading on paused-turn recovery.
   - It documents deferred `pendingBonusAction`, which is still real.
   - It does not mention `turnShouldEndAfterReaction`, which now prevents the resumed AI turn from consuming a queued decision meant for the next combatant.

7. `packages/game-server/src/application/services/combat/ai/CLAUDE.md` is mostly accurate, but its backend list is stale by omission.
   - It says to support Ollama/OpenAI/GitHub Models via factory + env.
   - Current source also supports Copilot.

8. `packages/game-server/src/infrastructure/llm/CLAUDE.md` is materially fine.
   - I did not find a concrete false statement there.
   - At most, it could be made more explicit about Copilot also being a backend, but that is an omission, not a misleading instruction.

## Recommended Doc Edits

### `.github/instructions/ai-behavior.instructions.md`

Replace the `LlmProvider` row in `Key Contracts` with:

> `LlmProvider` | `infrastructure/llm/types.ts` | Unified chat adapter for Ollama, OpenAI, GitHub Models, and Copilot backends

Replace the Mermaid `IAiBattlePlanner` method label with:

> `+generatePlan()`

Add this sentence near the top-level purpose/architecture description:

> AI behavior does not just “degrade gracefully” when LLM is unavailable. Turn decisions fall back to `DeterministicAiDecisionMaker`, and faction planning falls back to a deterministic battle-plan builder when the LLM planner is missing or returns `null`.

Add this sentence to the turn orchestration section after the decision step:

> If the configured `IAiDecisionMaker` returns `null`, the orchestrator retries that same step with deterministic AI before ending the turn.

Add this sentence to the deferred reaction / paused-turn notes:

> When a turn pauses for player input, the orchestrator may also persist `turnShouldEndAfterReaction` so the resumed AI turn ends cleanly instead of consuming a queued decision that belongs to the next combatant.

Replace the item-context wording in `Context Builder Patterns` with:

> Item-use context is now carried primarily by `canUseItems`, `usableItems`, and `bestBonusHealSpellEV`. `hasPotions` remains only as a backward-compatible compatibility flag for older prompt snapshots.

Add this sentence to `Context Builder Patterns`:

> `AiCombatContext` also includes `lastActionResult` for turn-local feedback and optional `mapData` for deterministic positioning heuristics, even though raw map data is not serialized into the LLM prompt.

Add this sentence to `System Prompt Engineering Conventions`:

> Before serializing the combat-state JSON, `LlmAiDecisionMaker` runs `truncateContextForLlm(...)` and may switch to a compact prompt variant for smaller models.

Replace the multiple-backends gotcha with:

> Multiple backends are supported through the env-driven factory: Ollama, OpenAI, GitHub Models, and Copilot. Provider selection is keyed off `DM_LLM_PROVIDER`, with backend-specific model and credential env vars validated by `factory.ts`.

### `packages/game-server/src/application/services/combat/ai/CLAUDE.md`

Replace law 1 with caveman wording:

> LLM optional always. If missing or null, deterministic AI take over.

Replace law 4 with caveman wording:

> Support Ollama, OpenAI, GitHub Models, Copilot. Pick by env + factory.

### `packages/game-server/src/infrastructure/llm/CLAUDE.md`

No required edit.

Optional caveman add if you want backend list symmetry:

> Factory pick backend by env. Ollama, OpenAI, GitHub Models, Copilot all valid.

### Mermaid

Mermaid would not materially improve this doc right now.

Reason:
- The main drift is stale names, missing fallback behavior, and omitted context fields, not missing topology.
- If a diagram is kept, a short sequence diagram of `AiTurnOrchestrator -> AiContextBuilder -> IAiDecisionMaker/deterministic fallback -> AiActionExecutor -> refresh state` would help more than the current class diagram.