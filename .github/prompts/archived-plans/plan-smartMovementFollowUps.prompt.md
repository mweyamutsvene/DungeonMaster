# Plan: Smart Movement — Follow-Up Work

**Status:** All Phases Complete  
**Parent:** [plan-smartMovement.prompt.md](plan-smartMovement.prompt.md)  
**Related:** [plan-syncMapEntities.prompt.md](plan-syncMapEntities.prompt.md)

**TL;DR:** The core smart movement feature (A* pathfinding, MoveTowardCommand, text parser, AI integration, path narration, 3 E2E scenarios) is implemented and passing. This plan covers the remaining follow-up work: additional E2E scenarios for edge cases, consistent narration integration, and path visualization in the tactical view. Map entity sync is tracked separately.

---

## Phase 1 — Additional E2E Test Scenarios

The original plan called for 7 scenarios; 3 exist (`move-toward-basic`, `move-toward-obstacle`, `move-toward-difficult-terrain`). Four scenarios remain:

### 1.1 — Hazard Avoidance (`move-toward-hazard-avoidance.json`)

**Goal:** Verify A* avoids lava/pit terrain and routes around it, even at increased distance cost.

```
Setup:
  - Fighter at (10, 10), speed 30
  - Goblin at (40, 10)
  - Lava strip at x=20..25, y=5..15 (same shape as obstacle scenario, but lava instead of wall)

Expected:
  - A* routes around the lava (south or north detour)
  - Movement is partial (detour exceeds 30ft budget)
  - narrationHints mention hazard avoidance ("Lava pit nearby" or similar)
  - Fighter does NOT cross any lava cell
```

**Implementation:**
1. Create `scripts/test-harness/scenarios/core/move-toward-hazard-avoidance.json`
2. Use `setTerrain` with `"terrain": "lava"` for the hazard strip
3. Assert `actionComplete: true` — movement completes (partial is fine)
4. Assert combat remains active

### 1.2 — Completely Blocked Path (`move-toward-blocked.json`)

**Goal:** Verify graceful failure when no path exists to the target.

```
Setup:
  - Fighter at (10, 10), speed 30
  - Goblin at (40, 10)
  - Complete wall enclosure around the goblin: walls at x=35..45, y=5..15 forming a box

Expected:
  - A* returns blocked: true
  - Fighter does NOT move (stays at 10, 10)
  - Response indicates path is blocked
  - No error thrown — graceful handling
```

**Implementation:**
1. Create `scripts/test-harness/scenarios/core/move-toward-blocked.json`
2. Use `setTerrain` with `"terrain": "wall"` forming a complete enclosure
3. Assert `actionComplete: true` (the action resolves even though blocked)
4. Assert fighter position unchanged via `assertState` if possible
5. Note: May need to check how `handleMoveTowardAction` communicates "blocked" — current code falls back to `reachablePosition` which may still move the fighter partway. Verify actual behavior and adjust expectation.

### 1.3 — Ranged Approach (`move-toward-ranged.json`)

**Goal:** Verify `desiredRange > 5` stops the character at the correct distance from the target.

```
Setup:
  - Fighter at (10, 10), speed 30
  - Goblin at (50, 10)
  - No obstacles

Expected:
  - LLM returns moveToward with desiredRange: 30 (bow range)
  - Fighter moves to (25, 10) or similar — 30ft away from goblin, 25ft from start (within 30ft speed)
  - Fighter does NOT end adjacent to the goblin
```

**Implementation:**
1. Create `scripts/test-harness/scenarios/core/move-toward-ranged.json`
2. This requires LLM to produce `desiredRange: 30`. Options:
   - Use mock AI behavior to inject the decision, OR
   - Use the text parser with explicit desiredRange (may need text parser enhancement for "move within bow range"), OR
   - Use `programmaticAction` type with explicit `moveToward` command
3. Assert fighter ends approximately 30ft from goblin, not adjacent
4. This scenario may expose that the text parser doesn't support desiredRange > 5 — document if so

### 1.4 — AI Pathfinding Around Obstacles (`ai-pathfinding.json`)

**Goal:** Verify AI monsters use A* pathfinding to navigate around obstacles.

```
Setup:
  - Fighter at (40, 10), speed 30
  - Goblin at (10, 10), speed 30
  - Wall at x=20..25, y=5..15 (between them)
  - Goblin goes first (higher initiative)

Expected:
  - AI Goblin uses moveToward targeting the Fighter
  - A* routes around the wall
  - Goblin ends within reach (or as close as possible with 30ft speed minus detour cost)
```

**Implementation:**
1. Create `scripts/test-harness/scenarios/core/ai-pathfinding.json`
2. Configure monster to go first (high DEX or seeded dice) 
3. Use MockAiDecisionMaker with `"approach"` behavior
4. Place wall obstruction, verify AI routes around it
5. Assert combat status remains Active after AI turn completes

---

## Phase 2 — Consistent Narration Integration

**Problem:** `buildPathNarration()` in `path-narrator.ts` is available but `handleMoveTowardAction()` in `action-dispatcher.ts` uses `eventEmitter.generateNarration()` and appends raw joined `pathNarrationHints` rather than calling the dedicated `buildPathNarration()` helper. This leads to inconsistent narration formatting.

### 2.1 — Audit narration emission points

Identify all places movement narration is emitted:
- `ActionDispatcher.handleMoveTowardAction()` — uses raw hint string joining
- `ActionDispatcher.handleMoveAction()` — may not include path hints at all
- `AiActionExecutor.executeMoveToward()` — verify it includes path narration
- `AiActionExecutor.executeMove()` — straight-line move, no path hints
- `TwoPhaseActionService.completeMove()` — final move completion narration

### 2.2 — Centralize path narration

1. Update `handleMoveTowardAction()` to call `buildPathNarration()` instead of manual string joining
2. Update `AiActionExecutor.executeMoveToward()` similarly
3. Ensure `buildPathNarration()` output is included in the action response's `description` field so the player-cli can display it
4. Add path narration to the `MOVE_EXECUTED` SSE event payload if not already present

### 2.3 — Enhance `buildPathNarration()` output

Currently the function is minimal (87 lines). Enhance to include:
- Cardinal direction of movement: "heads east toward the goblin"
- Distance remaining after partial move: "still 15ft away from the target"
- Multi-terrain transitions: "crosses open ground then enters difficult terrain"
- Context-aware verb choices: "dashes", "creeps", "charges" based on distance covered vs total speed

---

## Phase 3 — Path Visualization in Tactical View ✅

**Problem:** When a character pathfinds around obstacles, the tactical view doesn't show the computed path. Players see "moved to (x,y)" but not the route taken.

### 3.1 — Add path to tactical view response

1. Extend `TacticalView` type (or a sub-type) with optional `lastMovePath?: Position[]` per combatant
2. When a moveToward completes, store the path on the combatant's state (or in a transient field)
3. `TacticalViewService` includes the path in the response
4. Player-CLI renders path cells with a trail marker (e.g., `·` or `→`)

### 3.2 — CLI path rendering

1. In the player-cli's tactical view renderer, when `lastMovePath` is present:
   - Draw path cells as `·` or `→` characters on the grid
   - Show cardinal direction indicators for direction changes
   - Highlight terrain transitions along the path (color if terminal supports it)
2. Clear path visualization after the next action (path is ephemeral)

### 3.3 — Path metadata in action response

1. Add `path?: Position[]` to the action response type
2. `handleMoveTowardAction()` and `AiActionExecutor.executeMoveToward()` include the path
3. Player-CLI can optionally display "Route: (10,10) → (15,10) → (15,15) → (20,15) → ..." in verbose mode

---

## Phase 4 — Text Parser Enhancement for Range Intent

**Problem:** The text parser (`tryParseMoveTowardText()`) always defaults `desiredRange` to `undefined` (which becomes 5ft in `handleMoveTowardAction`). There's no way for a player to specify range intent through text alone without the LLM.

### 4.1 — Add range patterns to text parser

Add regex patterns to `tryParseMoveTowardText()` that extract range:
- `"move within (\d+)\s*(?:ft|feet|foot)\s+(?:of|from)\s+(.+)"` → `desiredRange: N, target: name`
- `"get within bow range of (.+)"` → `desiredRange: 30` (shortbow/longbow normal range)
- `"keep (\d+)\s*(?:ft|feet)\s+(?:away from|from)\s+(.+)"` → `desiredRange: N`
- `"move to ranged position (?:near|from)\s+(.+)"` → `desiredRange: 30`

### 4.2 — Return desiredRange from parser

Update `tryParseMoveTowardText()` return type to include `desiredRange?: number` so the dispatcher can pass it through.

### 4.3 — Add unit tests

Test the new patterns in the text parser test suite to ensure correct extraction.

---

## Verification

- `pnpm -C packages/game-server test` — all existing tests pass
- `pnpm -C packages/game-server test:e2e:combat:mock` — all scenarios pass including 4 new ones
- Manual test: "move to Goblin" with lava → path avoids lava, narration mentions hazard
- Manual test: "move within 30ft of Goblin" → stops at range, text parser handles it
- Tactical view shows path markers after moveToward

---

## Key Files to Modify

| File | Change |
|------|--------|
| **NEW** `scenarios/core/move-toward-hazard-avoidance.json` | Lava avoidance E2E scenario |
| **NEW** `scenarios/core/move-toward-blocked.json` | Completely blocked path E2E scenario |
| **NEW** `scenarios/core/move-toward-ranged.json` | Ranged approach (desiredRange > 5) |
| **NEW** `scenarios/core/ai-pathfinding.json` | AI monster pathfinding around obstacles |
| `combat/tabletop/action-dispatcher.ts` | Use `buildPathNarration()` consistently |
| `combat/tabletop/path-narrator.ts` | Enhance narration output (direction, distance remaining, terrain transitions) |
| `combat/tabletop/combat-text-parser.ts` | Add range-intent regex patterns, return `desiredRange` |
| `infrastructure/llm/ai-action-executor.ts` | Consistent path narration |
| `application/services/tactical-view-service.ts` | Add `lastMovePath` to tactical view (Phase 3) |
| `packages/player-cli/src/` | Path visualization in CLI renderer (Phase 3) |

---

## Priority Order

1. **Phase 1** (test scenarios) — highest priority, validates existing behavior edge cases
2. **Phase 4** (text parser range) — small, high-impact UX improvement
3. **Phase 2** (narration consistency) — quality improvement, lower risk
4. **Phase 3** (path visualization) — nice-to-have, larger scope, depends on tactical view changes

---

## Dependencies

- Phase 1 depends on nothing — can start immediately
- Phase 2 depends on nothing — can start immediately
- Phase 3 depends on Phase 2 (narration data needs to be in the right places first)
- Phase 4 depends on nothing — can start immediately
- Map Entity Sync (separate plan) is independent but enhances Phase 3 accuracy

---

## Implementation Notes (Completed)

### Phase 1 — E2E Scenarios ✅
All 4 new scenarios created and passing (68 total E2E scenarios, 0 failures):

1. **`move-toward-hazard-avoidance.json`** — Fighter(10,10) → Goblin(40,10) with lava strip at x=20-25/y=5-15. A* routes around lava successfully. Uses `setTerrain` with `"terrain": "lava"`.
2. **`move-toward-blocked.json`** — Fighter(10,10) → Goblin(40,10) with complete wall enclosure. Uses `expect.error: true, errorContains: "passable position"` since `handleMoveTowardAction` throws `ValidationError` when fully blocked (produces HTTP 400). This is the correct behavior — no silent failures.
3. **`move-toward-ranged.json`** — Fighter(10,10) → Goblin(60,10), text "move within 30ft of Goblin Scout". Text parser extracts `desiredRange: 30`. Uses `programmaticAction` with explicit text.
4. **`ai-pathfinding.json`** — Goblin(10,10) → Fighter(40,10), wall obstruction, `aiConfig.defaultBehavior: "approach"`. Low player initiative (seeded roll=1) ensures AI goes first.

**Infrastructure change:** Added `"approach"` to `ConfigureAiAction.defaultBehavior` type unions in `scenario-runner.ts` (3 locations) and `combat-e2e.ts` (1 location). The `MockAiDecisionMaker` already supported this behavior.

### Phase 2 — Narration Consistency ✅
- **2.2 — Centralized narration:** `handleMoveTowardAction()` in `action-dispatcher.ts` now calls `buildPathNarration()` instead of manual `pathResult.narrationHints.join(" ")`. Imported `buildPathNarration` from `./path-narrator.js` and `getNameFromCombatantRef` from `./combat-text-parser.js`.
- **2.3 — Enhanced output:**
  - Added `startPosition?` and `endPosition?` to `PathNarrationInput`
  - New `getCardinalDirection(from, to)` — 8-point compass using atan2
  - New `chooseMovementVerb(costFeet)` — "rushes" (≥25ft), "steps" (≤5ft), "moves" (default)
  - Narration template now includes cardinal direction and movement verb
- **2.1 — Audit:** Not fully audited; `AiActionExecutor.executeMoveToward()` still uses its own narration path. Could be centralized in a future pass.

### Phase 3 — Path Visualization ⏳ Deferred
Not implemented. Lowest priority per plan. Depends on:
- Extending `TacticalCombatant` with `lastMovePath?: Position[]`
- Updating `TacticalViewService` to include path data
- CLI rendering changes in `player-cli`

### Phase 3 — Path Visualization ✅
Implemented rich-client-ready path visualization:

**Domain layer** (`pathfinding.ts`):
- New `PathCell` interface: `{ x, y, terrain, stepCostFeet, cumulativeCostFeet }` — per-cell metadata computed from existing A* node data at zero additional cost
- `PathResult` extended with `cells: PathCell[]` alongside existing `path: Position[]` (backward compatible)
- `buildResult()` populates `cells` from `AStarNode` chain (terrain + cost delta per node)

**Application layer**:
- `ActionParseResult` — added proper `pathCells`, `pathCostFeet`, `pathfinding` fields, eliminated unsafe `as ActionParseResult` cast
- `handleMoveAction()` — synthesizes a 2-cell `PathCell[]` for straight-line moves (start → end, "normal" terrain)
- `handleMoveTowardAction()` — populates `pathCells` with rich `cells` from A* pathfinding, trims on partial paths
- Both handlers store `lastMovePath: { cells, costFeet }` on combatant resources (JSON blob)
- `resetTurnResources()` clears `lastMovePath` on turn change

**TacticalView** (`tactical-view-service.ts`):
- `TacticalView` interface extended with `lastMovePath?: { combatantId, cells: PathCell[], costFeet }`
- `getTacticalView()` reads `lastMovePath` from active combatant's resources

**Player CLI** (`player-cli`):
- `TacticalState` and `ActionResponse` types extended with path fields
- `printMovePath()` function renders compact trail: `Path: (10,10) → (15,10) → (20,10) [difficult] → (25,10) [30ft]`
- Called from `printTacticalState()` when `lastMovePath` is present
- Non-"normal" terrain cells annotated with `[terrain]` tags

**Rich client usage**: Any HTTP client consuming `GET .../tactical` gets full per-cell metadata for:
- Animated token movement along cell sequence
- Trail rendering with terrain-colored cells
- Cost overlay labels (`cumulativeCostFeet` per cell)
- Terrain alerts (`stepCostFeet > 5` = difficult terrain)
- Pathfinding preview (future `POST .../path-preview` endpoint)

### Phase 4 — Text Parser Range Intent ✅
- Enhanced `tryParseMoveTowardText()` return type to `{ target: CombatantRef; rawTargetName: string; desiredRange?: number } | null`
- Added 5 range-aware regex patterns checked BEFORE the 8 standard patterns:
  1. `"move/get within Nft of <target>"` → numeric desiredRange
  2. `"keep Nft from <target>"` → numeric desiredRange
  3. `"move to ranged position near <target>"` → fixedRange: 30
  4. `"move/get within bow range of <target>"` → fixedRange: 30
  5. `"move/get within spell range of <target>"` → fixedRange: 30
- Dispatcher now passes `directMoveToward.desiredRange` through to `handleMoveTowardAction` (was `undefined`)
- Added `getNameFromCombatantRef(ref, roster)` helper for resolving CombatantRef to display name

### Test Results
- TypeScript: clean compile (`pnpm -C packages/game-server typecheck` + `pnpm -C packages/player-cli typecheck`)
- Unit tests: 410 passed, 36 skipped, 0 failed
- E2E tests: **68 passed, 0 failed**

### Open Items
- ~~`AiActionExecutor.executeMoveToward()` narration not yet centralized through `buildPathNarration()`~~ ✅ Done — both narration paths (no-reactions and post-OA) now call `buildPathNarration()` with actor/target names, cardinal direction, and movement verb
- ~~No unit tests added for the new text parser range patterns (Phase 4.3) — covered by E2E scenario `move-toward-ranged.json` but dedicated unit tests would be a good addition~~ ✅ Done — 27 unit tests in `combat-text-parser.test.ts` covering all 5 range patterns, 8 standard patterns, and `findCombatantByName`
- ~~Future: `POST .../combat/path-preview` endpoint for rich clients to preview paths before committing~~ ✅ Done — `POST /sessions/:id/combat/:encounterId/path-preview` endpoint added to `session-tactical.ts`
