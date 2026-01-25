# Plan: AI Module Refactor

Split the 1,500-line `MonsterAIService` into focused modules, rename to reflect actual scope (handles all AI combatants, not just monsters), delete orphaned interface, and clean up. Goal: smaller files, clearer responsibilities, easier testing.

## Steps

1. **Delete orphaned `ICombatNarrator`** — [combat-narrator.ts](packages/game-server/src/application/services/combat/ai/combat-narrator.ts) is defined but has no infrastructure adapter and is never used. Remove it.

2. **Rename `MonsterAIService` → `AiTurnOrchestrator`** in [monster-ai-service.ts](packages/game-server/src/application/services/combat/ai/monster-ai-service.ts) and rename file to `ai-turn-orchestrator.ts`. Update all imports (~5 locations). The service handles Monsters, NPCs, and AI-controlled Characters — not just monsters.

3. **Create `ai-types.ts`** to consolidate types:
   - Move `AiDecision` and `IAiDecisionMaker` from `ai-decision-maker.ts`
   - Move `TurnStepResult` type (currently inline in monster-ai-service.ts)
   - Delete now-empty `ai-decision-maker.ts`

4. **Extract `AiContextBuilder` class** (~200 lines) to new file `ai-context-builder.ts`:
   - Move `buildCombatContext()` method (lines 412-720)
   - Move helper functions: position extraction, economy parsing, name resolution
   - Single responsibility: Build the context payload for LLM decisions

5. **Extract `AiActionExecutor` class** (~500 lines) to new file `ai-action-executor.ts`:
   - Move `executeMonsterAction()` method (lines 726-1250)
   - Move `executeBonusAction()` method (lines 1259-1380)
   - Move helper functions: `findCombatantByName()`, `toCombatantRef()`, `normalizeName()`
   - Remove duplicate `buildActorRef()` inline function (use class method from orchestrator)

6. **Clean up `AiTurnOrchestrator`** (remaining ~300 lines):
   - Keep: `processMonsterTurnIfNeeded()`, `executeMonsterTurn()`, `processAllMonsterTurns()`, `fallbackSimpleTurn()`
   - Keep: `buildActorRef()` helper, `aiLog()`, `aiDecideReaction()`
   - Inject new `AiContextBuilder` and `AiActionExecutor` as dependencies

7. **Update barrel exports** in [index.ts](packages/game-server/src/application/services/combat/ai/index.ts):
   ```typescript
   export * from "./ai-types.js";
   export * from "./ai-turn-orchestrator.js";
   export * from "./ai-context-builder.js";
   export * from "./ai-action-executor.js";
   ```

8. **Update infrastructure LLM imports** — `LlmAiDecisionMaker` imports `IAiDecisionMaker` and `AiDecision` from new `ai-types.js` path

9. **Update test imports** — `ai-actions.test.ts` and `ai-actions.llm.test.ts` will need import updates after rename

10. **Run validation:** Execute `pnpm typecheck` and `pnpm test` to confirm no breakage

## Proposed File Structure

```
combat/ai/
├── ai-types.ts                 # All interfaces + types (~60 lines)
├── ai-turn-orchestrator.ts     # Turn flow orchestration (~300 lines)
├── ai-context-builder.ts       # LLM context construction (~200 lines)
├── ai-action-executor.ts       # Action execution logic (~500 lines)
└── index.ts                    # Barrel exports
```

## Line Count Before/After

| File | Before | After |
|------|--------|-------|
| `monster-ai-service.ts` | 1,498 | 0 (deleted) |
| `ai-decision-maker.ts` | 32 | 0 (merged into types) |
| `combat-narrator.ts` | 15 | 0 (deleted - orphaned) |
| `ai-types.ts` | - | ~60 |
| `ai-turn-orchestrator.ts` | - | ~300 |
| `ai-context-builder.ts` | - | ~200 |
| `ai-action-executor.ts` | - | ~500 |
| **Total** | **1,545** | **~1,060** |

## Further Considerations

1. **Debug flag duplication** — Both `AiTurnOrchestrator` and `LlmAiDecisionMaker` check `DM_AI_DEBUG`. Consider extracting to shared config utility in future cleanup.

2. **Dependency injection** — With 13 constructor params in `AiTurnOrchestrator`, consider bundling into an `AiDependencies` interface to reduce constructor bloat.

3. **`INarrativeGenerator` stays in infrastructure** — It's correctly placed and actively used. The `intentNarration` field in `AiDecision` provides AI's "before action" flavor text, which is emitted as `NarrativeText` events.
