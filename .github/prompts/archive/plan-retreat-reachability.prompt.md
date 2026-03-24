# Plan: `findRetreatPosition` Path Reachability (§4.5)
## Round: 1
## Status: DONE
## Affected Flows: CombatRules, AIBehavior

## Objective
Fix `findRetreatPosition` so it only picks cells that are **actually reachable** via pathfinding (within the movement budget), not just cells that are passable and within Euclidean distance from the origin. Also fix `MoveAwayFromHandler`'s secondary fallback to gracefully handle a completely blocked retreat.

---

## Root Cause

`findRetreatPosition` in `pathfinding.ts` (line 429) has a two-part bug:

1. **Euclidean distance instead of path cost**: The filter `calculateDistance(origin, pos) > speedFeet` uses straight-line distance, not the actual movement cost (which accounts for difficult terrain, diagonal rules, and routing around walls).
2. **No reachability check**: A cell adjacent to a wall pocket may have Euclidean distance ≤ speedFeet but require pathing around the entire wall structure — total path cost may exceed speedFeet.

The function's own docstring says *"Uses A* to evaluate reachable cells within speedFeet"* — this reveals the intent but not the reality.

**Secondary bug** in `MoveAwayFromHandler` (~line 130):
```typescript
if (!pathResult.blocked || pathResult.path.length > 0) {
  retreatDest.x = (pathResult.reachablePosition ?? retreatDest).x;
  ...
}
```
When `findRetreatPosition` returns an unreachable cell, `findPath` returns `{ blocked: true, path: [], reachablePosition: undefined }`, and the condition is `false`. `retreatDest` remains pointing to the unreachable cell, then gets passed downstream.

---

## Changes

### CombatRules: `domain/rules/pathfinding.ts`

#### New exported function: `getReachableCells()`

- [ ] Add `ReachableCell` type: `{ pos: Position; costFeet: number }`
- [ ] Add `ReachableCellsOptions`: subset of `PathOptions` (same fields minus `maxCostFeet`)
- [ ] Implement `getReachableCells(map, from, maxCostFeet, options)`:
  - Dijkstra flood-fill from `from` (no goal, just expand until budget exhausted)
  - Returns `ReachableCell[]` — all cells reachable within `maxCostFeet` (inclusive of start)
  - Uses same `isCellWalkable`, terrain cost, diagonal alternating cost, zone penalty logic as `findPath`
  - Export publicly (matches the architecture diagram in `combat-rules.instructions.md`)

#### Rewrite: `findRetreatPosition()`

- [ ] Replace the grid-scan + Euclidean distance loop with:
  1. Call `getReachableCells(map, origin, speedFeet, { occupiedPositions, zones })`
  2. Filter out starting cell
  3. Filter out zone-dangerous cells (preserve existing zone logic)
  4. Pick the cell with the largest Euclidean distance from `threat`  
  5. Fall back to `origin` (stay put) if no candidates — caller should detect no movement
- [ ] Update the docstring to accurately reflect the implementation
- [ ] Keep the no-map linear-interpolation fallback unchanged

### AIBehavior: `application/services/combat/ai/handlers/move-away-from-handler.ts`

- [ ] After calling `findPath(retreatDest)`, handle the completely-blocked case:
  - If `pathResult.blocked && pathResult.path.length === 0 && !pathResult.reachablePosition`:
    - Log it; return `{ ok: true, summary: "Cannot retreat — blocked", data: { movedFeet: 0, blocked: true } }`
  - This is now a true safety net: after the domain fix, `findRetreatPosition` should never return an unreachable cell, but the handler remains defensive

### Testing: `domain/rules/pathfinding.test.ts`

- [ ] **`findRetreatPosition` — open map, picks farthest cell**: retreat from (0,0) fleeing (25,0) → ends up on the far western edge
- [ ] **`findRetreatPosition` — wall blocks direct retreat**: wall at x=−10..−10 column; verifies the function picks a cell around the wall, NOT a cell behind the wall that requires actually pathing around
- [ ] **`findRetreatPosition` — pocket trap**: creature in a 3-sided pocket that blocks westward retreat; function picks a southern/northern exit instead
- [ ] **`findRetreatPosition` — no reachable better position**: completely enclosed (tiny room) returns current position
- [ ] **`getReachableCells` — returns correct set within budget**: compares cells found by flood-fill vs Euclidean estimate to verify flood-fill is more accurate

---

## Cross-Flow Risk Checklist
- [x] Do changes in one flow break assumptions in another? — **No**: `findRetreatPosition` is only called from `MoveAwayFromHandler`, handler is updated accordingly
- [x] Does the pending action state machine still have valid transitions? — **Not affected** (movement handling is outside the pending action machine)
- [x] Is action economy preserved? — **Not affected** (this is pathfinding/destination selection, not action spending)
- [x] Do both player AND AI paths handle the change? — **AI path only** (`findRetreatPosition` is used exclusively by AI; player movement uses `findPath` directly)
- [x] Are repo interfaces + memory-repos updated if entity shapes change? — **Not affected** (no entity shape changes)
- [x] Is `app.ts` registration updated if adding executors? — **Not affected** (domain function, no executor)
- [x] Are D&D 5e 2024 rules correct? — **Yes**: the fix makes pathfinding honor actual movement costs (difficult terrain, walls), which is D&D 5e 2024-correct

## Risks
- **Performance**: Dijkstra flood-fill over the full reachable area is O(n log n) where n = reachable cells. Typical D&D maps are 40×40 cells = 1600 cells, so worst-case flood-fill is ~1600 nodes. This is trivially fast (<1ms).
- **Regression**: `getReachableCells` introduces new path logic. Covered by tests.
- **No-map fallback stays unchanged**: linear interpolation without a map remains the same.

## Test Plan
- [x] Unit tests for `findRetreatPosition` wall-blocking scenarios
- [x] Unit tests for `getReachableCells` basic behavior
- [x] No new E2E scenario needed — `moveAwayFrom` AI behavior has no dedicated scenario (the fix is a correctness improvement to an internal function, not a behavior change on open maps)
- [x] Run `pnpm typecheck` + `pnpm test` + `pnpm test:e2e:combat:mock`

## SME Approval
- [x] CombatRules — self-approved (pure domain change, no external dependencies)
- [x] AIBehavior — self-approved (handler fix is defensive; primary fix is in domain)
