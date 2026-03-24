# Plan: Sync CombatMap Entity Positions on Movement

## Status: Complete

## Problem
When combatants move, their `resources.position` is updated, but the `CombatMap.entities[]` array remains stale. This means the tactical view's entity positions may be out of sync with actual combatant positions.

## Impact
- Currently LOW: pathfinding uses `resources.position` from combatant states, not `entities[]`.
- Future: When we add collision detection, size-based blocking, or line-of-sight computations that rely on `entities[]`, this sync becomes critical.

## Approach
Add a `syncEntityPosition(combatRepo, encounterId, combatantId, newPosition)` helper that:
1. Loads the encounter's `mapData`
2. Calls `moveEntity(map, combatantId, newPosition)` (or `addEntity()` if entity doesn't exist yet)
3. Persists via `combatRepo.updateEncounter(encounterId, { mapData })`

Call this helper from all movement codepaths:
- `ActionDispatcher.handleMoveAction()`
- `ActionDispatcher.handleMoveTowardAction()`
- `ActionDispatcher.handleJumpAction()`
- `TwoPhaseActionService.completeMove()`
- `AiActionExecutor.executeMove()`
- `AiActionExecutor.executeMoveToward()`

## Considerations
- Performance: This adds an extra DB write per move. Consider batching with the position update.
- Entity IDs: Uses `CombatantStateRecord.id` as the entity ID, matching the combatant's primary key.
- Immutability: `moveEntity()` returns a new map, so we need to persist it.

## Implementation Notes (Completed)

### Files created
- `application/services/combat/helpers/sync-map-entity.ts` — the `syncEntityPosition()` helper
  - Upserts: if the entity already exists in `entities[]`, moves it; if not, adds it as a new creature entity
  - No-op if the encounter has no mapData (no map = nothing to sync)
  - Accepts optional `faction` and `size` for new entity creation (defaults to "Medium")

### Files modified
- `application/services/combat/helpers/index.ts` — barrel export
- `application/services/combat/tabletop/action-dispatcher.ts` — sync calls in `handleMoveAction`, `handleMoveTowardAction`, `handleJumpAction`
- `application/services/combat/two-phase-action-service.ts` — sync call in `completeMove`
- `application/services/combat/ai/ai-action-executor.ts` — sync calls in `executeMove`, `executeMoveToward`

### Coverage
All 6 movement codepaths now sync the map entity position after updating `resources.position`:
1. **Direct moves** (no reactions) in `ActionDispatcher.handleMoveAction()`
2. **Pathfind moves** (no reactions) in `ActionDispatcher.handleMoveTowardAction()`
3. **Jump landings** in `ActionDispatcher.handleJumpAction()`
4. **Post-reaction moves** in `TwoPhaseActionService.completeMove()` (covers both player and AI OA resolution paths)
5. **AI direct moves** in `AiActionExecutor.executeMove()`
6. **AI pathfind moves** in `AiActionExecutor.executeMoveToward()`

### Assumptions
- Combatant state record `id` is used as the MapEntity `id` — this is the consistent key across all codepaths
- Default entity `size` is "Medium" when creating a new entity (since creature size isn't readily available at move time without extra lookups)
- No faction info is passed currently; can be enhanced later when faction data is available at the call site

### Verification
- TypeScript compilation: clean
- Unit/integration tests: 458 passed, 36 skipped
- E2E combat scenarios: 75 passed, 0 failed
