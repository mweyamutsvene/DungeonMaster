# Plan: AI DB Query Batching (AI-L1, AI-L2)

## Problem

Two related performance issues in the AI turn execution path:

### AI-L1: N+M queries per AI context build
`AiContextBuilder.buildAllyDetails()` and `buildEnemyDetails()` call repo methods per creature.
The `prefetchEntities()` method already addresses this by pre-loading all entities into an
`EntityCache` via `Promise.all()`. However, `factionService.getAllies()` and `getEnemies()` may
still issue `listCombatants()` calls internally, adding additional round-trips.

**Fix**: Audit `FactionService.getAllies/getEnemies` to accept a pre-loaded combatants list
instead of re-loading from the repo. Pass the list already loaded in `processMonsterTurnIfNeeded`.

### AI-L2: Multiple encounter/combatant loads per AI turn loop
`AiAttackResolver.resolve()` calls `combat.getEncounterById(encounterId)` and
`combat.listCombatants(encounterId)` inside the flanking check path. These are already
available from the outer turn orchestrator loop.

**Fix**: Extend `AiAttackParams` (in `ai-attack-resolver.ts`) with optional fields:
```typescript
/** Optional pre-loaded encounter for flanking/map checks (avoids redundant DB call). */
encounter?: CombatEncounterRecord;
/** Optional pre-loaded combatant list for flanking checks (avoids redundant DB call). */
allCombatants?: CombatantStateRecord[];
```
Then pass these from the caller (`AttackHandler.execute` in `handlers/attack-handler.ts`),
which has `ctx.allCombatants` available. The flanking check code in `resolve()` would use the
passed values when available and fall back to DB loads only when absent.

## Files to Modify

- `packages/game-server/src/application/services/combat/ai/ai-attack-resolver.ts`
  - Add optional `encounter?` and `allCombatants?` to `AiAttackParams`
  - Use them in the flanking check block instead of re-loading from DB

- `packages/game-server/src/application/services/combat/ai/handlers/attack-handler.ts`
  - Pass `encounter` and `ctx.allCombatants` to the `AiAttackResolver.resolve()` call

- `packages/game-server/src/application/services/combat/helpers/faction-service.ts`
  - Add optional `allCombatants?` param to `getAllies()/getEnemies()` to skip repo load
  - `AiTurnOrchestrator.executeAiTurn()` passes its `allCombatants` snapshot

## Notes

- Both changes are performance-only — behavior must not change
- `allCombatants` snapshot from the outer loop may be slightly stale by the time inner
  handlers run; this is acceptable since it's refreshed after each action step anyway
- Measure query count before/after using `DM_DEBUG_LOGS=1` output
