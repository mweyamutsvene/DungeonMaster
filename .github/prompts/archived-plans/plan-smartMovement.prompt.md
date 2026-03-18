# Plan: Smart Movement — "Move to Creature" + A* Pathfinding

**TL;DR:** Today movement requires exact `(x, y)` coordinates. This plan adds natural-language creature targeting ("Move to Orc"), a domain-layer A* pathfinder on the existing 5ft grid, terrain-aware path narration, and LLM-inferred stopping distance. The LLM decides whether you stop at melee range, ranged distance, or something else based on context. Both player-facing and AI movement benefit from the same pathfinding backbone. The `CombatMap` already has terrain types, passability, and grid cells — A* plugs directly into that.

---

## Phase 1 — Domain: A* Pathfinding Engine

1. **Create** new file `domain/rules/pathfinding.ts` with:
   - `PathNode` type: `{ position: Position; gCost: number; hCost: number; fCost: number; parent: PathNode | null; terrainType: TerrainType }`
   - `PathResult` type: `{ path: Position[]; totalCostFeet: number; blocked: boolean; terrainEncountered: TerrainType[]; narrationHints: string[] }`
   - `findPath(map: CombatMap, from: Position, to: Position, options?: PathOptions): PathResult` — A* on the 5ft grid using `getCellAt()` for passability and `getTerrainSpeedModifier()` for cost
   - `PathOptions`: `{ maxCostFeet?: number; avoidHazards?: boolean; occupiedPositions?: Position[] }` — cap at movement speed, optionally avoid `hazard`/`lava` cells, treat occupied squares as impassable
   - 8-directional adjacency (including diagonals at 5ft cost per D&D 5e 2024 rules — every other diagonal costs 10ft)
   - Heuristic: Chebyshev distance (max of |dx|, |dy|) on grid cells — matches D&D diagonal rules
   - Along the path, collect `narrationHints[]` like `"The path detours around a wall"`, `"Difficult terrain slows movement through (25, 10)"`, `"Hazardous lava pit nearby — taking a longer route"`

2. **Create** `findAdjacentPosition(map: CombatMap, targetPos: Position, approachFrom: Position, desiredRange: number): Position | null` in the same file — finds the nearest passable cell within `desiredRange` feet of `targetPos` that is closest to `approachFrom`. This handles "which square next to the Orc do I actually stop at?"

3. **Add unit tests** in `domain/rules/pathfinding.test.ts` — straight-line path, wall detour, difficult terrain cost, unreachable target, hazard avoidance, diagonal movement cost, `findAdjacentPosition` with and without obstructions around the target.

---

## Phase 2 — Domain: New Move Command Variant

4. **Add `MoveTowardCommand`** in `application/commands/game-command.ts`:
   - Type: `{ kind: "moveToward"; actor: CombatantRef; target: CombatantRef; desiredRange?: number; encounterId?: string }`
   - `desiredRange` defaults to `5` (melee) but can be set by the LLM to e.g. `30` for a ranged approach
   - Add to the `GameCommand` union type

5. **Update `buildGameCommandSchemaHint()`** to include the new variant with an explanation:
   - Add the `moveToward` type definition to the schema hint string
   - Add rule: *"Use kind='moveToward' when the player wants to move to/toward/near a creature. The LLM should infer desiredRange: 5 for melee intent, or a larger number if the player implies ranged positioning (e.g., 'get within bow range'). If unclear, default to 5."*
   - Keep the old `move` kind for explicit coordinate movement

6. **Update `parseGameCommand()`** to handle `kind: "moveToward"` and produce a `MoveTowardCommand`.

---

## Phase 3 — Application: Text Parser + Action Dispatcher

7. **Add `tryParseMoveTowardText(text, roster)`** in `combat-text-parser.ts`:
   - Regex patterns: `move\s+(?:to|toward|towards|near|next to|up to|closer to)\s+(.+)`, `approach\s+(.+)`, `advance\s+(?:on|toward)\s+(.+)`, `close\s+(?:distance|in)\s+(?:on|with|to)\s+(.+)`
   - Extract the creature name, call `findCombatantByName(name, roster)` to resolve to a `CombatantRef`
   - Return `{ target: CombatantRef; rawTargetName: string } | null`
   - Explicitly reject if the text contains coordinate parentheses `(x, y)` to avoid stealing from `tryParseMoveText()`

8. **Insert into dispatch chain** in `action-dispatcher.ts` — call `tryParseMoveTowardText(text, roster)` right **after** `tryParseMoveText()` to check for creature name before falling through to LLM

9. **Add `handleMoveTowardAction()`** in `action-dispatcher.ts`:
   - Resolve `target` CombatantRef → target position via `findCombatantStateByRef()` + `getPosition()`
   - Resolve actor's current position
   - Call `findAdjacentPosition(map, targetPos, actorPos, desiredRange ?? 5)` to compute the actual destination
   - Call `findPath(map, actorPos, destination, { maxCostFeet: movementRemaining, occupiedPositions })` to get the A* path
   - If path is blocked (no route to destination), clamp to the farthest reachable cell along the path and report "blocked" narration
   - Clamp path to creature's remaining movement speed
   - Collect `narrationHints` from the `PathResult` for the response
   - Delegate the resolved `{ x, y }` destination to existing `handleMoveAction()` — reuse the two-phase OA flow completely

10. **Add convenience helper** `getPositionByRef(combatants, ref)` in `combatant-ref.ts` to reduce boilerplate.

---

## Phase 4 — Application: Integrate Pathfinding into Existing Move Flow

11. **Update `TwoPhaseActionService.initiateMove()`** in `two-phase-action-service.ts` to:
    - Accept an optional `path: Position[]` parameter (the pre-computed A* path)
    - If path is provided, check **each cell along the path** for terrain speed modifiers (summing actual cost), not just the destination cell
    - Check OAs along the **path** rather than just start→end (creature enters and exits reach zones per cell)
    - Store the `path` and `narrationHints` on the `PendingAction` for later narration
    - If no path is provided (backward compat), fall back to the existing straight-line behavior

12. **Update OA detection** to check path cells — for each hostile combatant, detect if any cell transition along the path triggers `crossesThroughReach()`. This is more accurate than the current start-in-reach→end-out-of-reach check for non-linear paths.

---

## Phase 5 — LLM Integration

13. **Update LLM `moveToward` fallback** in the dispatch chain — when the text parser doesn't match but the LLM returns `kind: "moveToward"`, the dispatcher routes to `handleMoveTowardAction()` with the LLM's `target` ref and `desiredRange`.

14. **Update `buildGameCommandSchemaHint()`** examples to show a `moveToward` example alongside the existing `move` example: `{ kind: "moveToward", actor: { type: "Character", characterId: "..." }, target: { type: "Monster", monsterId: "..." }, desiredRange: 5 }`.

15. **Update AI decision maker** in `ai-decision-maker.ts` — add `moveToward` as a valid action for AI creatures, with the same target/desiredRange semantics. This lets the LLM say "move toward the fighter" instead of computing raw coordinates.

16. **Update AI action executor** in `ai-action-executor.ts` — if AI decision is `"moveToward"` with a target ref, use the same `handleMoveTowardAction` logic (resolve target → A* path → clamp → two-phase move). Replace the simple straight-line clamping with pathfinding.

---

## Phase 6 — Path Narration

17. **Add `buildPathNarration(path: Position[], map: CombatMap, narrationHints: string[]): string`** in a new `path-narrator.ts` or in `tabletop-event-emitter.ts`:
    - Iterate path cells, detect transitions (enter difficult terrain, pass near hazard, detour around wall)
    - Produce natural descriptions: *"You cut through difficult terrain, slowing your advance"*, *"A wall blocks the direct path — you detour east"*, *"Lava pit to the north; taking the safer southern route"*
    - Include these in the move-complete event's narration/description

18. **Integrate narration** into `handleMoveAction()` / `handleMoveTowardAction()` response so the player sees contextual path descriptions.

---

## Phase 7 — Test Scenarios + Mock AI

19. **Add mock AI "approach" behavior** in `mocks/index.ts` — a `MockAiDecisionMaker` behavior that produces `moveToward` decisions targeting the nearest enemy.

20. **Create test scenarios** in `scripts/test-harness/scenarios/`:
    - **`move-to-creature-basic.json`**: Player says "move to Goblin" → resolves to 5ft from goblin, attack follows
    - **`move-to-creature-obstacle.json`**: Wall between player and target → A* detour, narration describes the detour, verifies extra distance cost
    - **`move-to-creature-difficult-terrain.json`**: Path through difficult terrain → halved speed on those cells, narration mentions slow ground
    - **`move-to-creature-hazard-avoidance.json`**: Lava between player and target → A* avoids hazard, longer path
    - **`move-to-creature-blocked.json`**: Completely walled off → movement fails gracefully with "no path" message
    - **`move-to-creature-ranged.json`**: Ranged intent ("move within bow range of Orc") → stops at ~30ft
    - **`ai-pathfinding.json`**: Monster uses A* to navigate around obstacle to reach player

21. **Add `setObstacle` convenience** to scenario runner (or extend `setTerrain`) to place walls/obstacles in bulk for pathfinding tests.

---

## Phase 8 — Map Entity Sync (Prep for Future)

22. **Sync `CombatMap.entities[]` positions** when combatants move — currently entity positions in `mapData` are disconnected from `resources.position`. When position is updated in `handleMoveAction`, also call `moveEntity()` on the `CombatMap`. This prepares for collision detection and size-based blocking in the future.

---

## Verification

- `pnpm -C packages/game-server test` — all existing tests pass (backward compat)
- `pnpm -C packages/game-server test:e2e:combat:mock` — all existing + new scenarios pass
- New unit tests in `pathfinding.test.ts` cover straight-line, detour, blocked, hazard, diagonal cost
- Manual test via player-cli: type "move to Goblin" → character pathfinds to adjacent square, narrative describes path
- Manual test: place wall between character and monster, type "move to Goblin" → A* detour visible in narration
- Verify AI monsters pathfind around obstacles instead of getting stuck

---

## Key Decisions

- **LLM decides stopping distance**: `desiredRange` is inferred by the LLM from natural language context (melee vs ranged intent), defaulting to 5ft if unclear
- **A* with 8-directional movement**: uses D&D 5e 2024 diagonal rules (alternating 5/10ft cost)
- **Pathfinding is domain-layer**: pure function in `domain/rules/pathfinding.ts`, no infrastructure dependencies
- **Backward compatible**: existing `move` command with `{x,y}` coordinates still works unchanged. `moveToward` is additive
- **Both players and AI** share the same pathfinding engine
- **Text parser + LLM fallback**: simple patterns like "move to Orc" are caught by regex first (fast, no LLM call); complex/ambiguous phrases fall through to LLM which can return `moveToward`
- **OA detection along path**: phases in alongside A* so non-linear paths correctly trigger OAs at each cell transition, not just start/end

---

## Key Files Modified

| File | Change |
|------|--------|
| **NEW** `domain/rules/pathfinding.ts` | A* engine + `findAdjacentPosition` |
| **NEW** `domain/rules/pathfinding.test.ts` | Unit tests |
| **NEW** `application/services/combat/tabletop/path-narrator.ts` | Path narration builder |
| `application/commands/game-command.ts` | `MoveTowardCommand` type + schema hint + parser |
| `application/services/combat/tabletop/combat-text-parser.ts` | `tryParseMoveTowardText()` |
| `application/services/combat/tabletop/action-dispatcher.ts` | `handleMoveTowardAction()` + dispatch chain update |
| `application/services/combat/two-phase-action-service.ts` | Path-aware terrain cost + path-based OA detection |
| `application/services/combat/helpers/combatant-ref.ts` | `getPositionByRef()` convenience |
| `infrastructure/llm/ai-decision-maker.ts` | `moveToward` action for AI |
| `infrastructure/llm/ai-action-executor.ts` | Pathfinding-based AI movement |
| `infrastructure/llm/mocks/index.ts` | Mock "approach" behavior |
| **NEW** `scripts/test-harness/scenarios/core/move-to-creature-*.json` | 7 new test scenarios |
| `scripts/test-harness/scenario-runner.ts` | `setObstacle` convenience |

---

## Implementation Notes (Completed)

### Summary
All core phases (1-7) implemented and verified. Phase 8 (Map Entity Sync) deferred to separate plan (`plan-syncMapEntities.prompt.md`).

### What was done
- **Phase 1**: A* pathfinding engine with 19 passing unit tests. 8-directional movement, D&D 5e 2024 alternating diagonal cost (5/10ft), Chebyshev heuristic, terrain cost multipliers, hazard avoidance, occupied position blocking, movement budget caps, narration hint generation.
- **Phase 2**: `MoveTowardCommand` type added to game command union with schema hint and parser.
- **Phase 3**: Text parser `tryParseMoveTowardText()` with 8 regex patterns, dispatch chain integration in `ActionDispatcher`, full `handleMoveTowardAction()` with pathfinding → initiateMove → position update.
- **Phase 4**: Path-aware `InitiateMoveInput` extensions. Two-phase action service validates path cost against speed and performs cell-by-cell OA detection along the path.
- **Phase 5**: `AiDecision.action` union expanded with `"moveToward"`. LLM system prompt updated with action description, examples, and output format. `LlmAiDecisionMaker.parseDecision()` handles `moveToward`. `AiActionExecutor.executeMoveToward()` resolves target → A* path → clamp → two-phase move.
- **Phase 6**: `path-narrator.ts` created with `buildPathNarration()` for human-readable descriptions. Exported from barrel.
- **Phase 7**: MockAiDecisionMaker `"approach"` behavior added. Two E2E scenarios created: `move-toward-basic.json` and `move-toward-obstacle.json`.
- **Phase 8**: Deferred to `plan-syncMapEntities.prompt.md` — entity position sync on movement is a cross-cutting concern that affects many codepaths. Currently pathfinding uses `resources.position` (not `entities[]`), so it works without this sync.

### Test Results
- **Unit tests**: 410 passed, 36 skipped (LLM-only), 0 failed
- **E2E scenarios**: 63 passed, 0 failed (includes 2 new move-toward scenarios)
- **TypeScript**: Compiles clean with no errors

### Assumptions Made
- `desiredRange` defaults to 5 (melee) when not specified by LLM or text
- Pathfinding uses `resources.position` as source of truth for combatant locations, not `CombatMap.entities[]`
- `moveToward` is treated as movement (not an Action), same as `move` — does not consume action economy
- When no combat map is available, falls back to linear interpolation (same as before)

### Open Questions / Follow-ups
- Phase 8 (Map Entity Sync) needs implementation — see `plan-syncMapEntities.prompt.md`
- Additional test scenarios could be added: difficult terrain + moveToward, hazard avoidance, completely blocked path, ranged approach (desiredRange > 5), AI pathfinding around obstacles
- Consider adding path visualization to the tactical view / CLI display
- Narrative integration could be enhanced to use `buildPathNarration()` more consistently across all movement handlers
