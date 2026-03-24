# SME Research: CombatRules — Cover Detection §4.4

## Task
Improve `getCoverLevel()` in `combat-map-sight.ts` to use proper ray-marching instead of the current 4-adjacent-cell heuristic.

## Affected Files
- `packages/game-server/src/domain/rules/combat-map-sight.ts` — primary change
- `packages/game-server/src/domain/rules/combat-map.test.ts` — test updates

## Current Implementation Analysis

### `getCoverLevel()` — What it does now
1. Constructs 4 positions: N/S/E/W of the target (one grid unit away)
2. For each, checks the cell's terrain type
3. Applies geometry filter: `distToTarget < distAttackerToCover && distAttackerToCover < distAttackerToTarget`
4. Returns best cover found

### Bugs in current implementation
**Bug 1: Only checks 4 cardinal neighbors of the target**
- If cover is two cells back from the target (e.g., a wall at the midpoint of the attacker→target line), it is completely missed.
- Example: Attacker at (0,0), Target at (30,0), Wall at (15,0) → getCoverLevel returns "none" when it should return "full".

**Bug 2: Ignores `"wall"` and `"obstacle"` terrain types**
- `terrain === "wall"` is not in the cover switch statement. A wall on the path isn't counted as full cover.
- `terrain === "obstacle"` also not counted.
- Only `"cover-half"`, `"cover-three-quarters"`, `"cover-full"` are handled.

```typescript
// EXISTING switch (in loop body) — misses wall and obstacle:
if (cell.terrain === "cover-full") return "full";
if (cell.terrain === "cover-three-quarters") { ... }
if (cell.terrain === "cover-half" && bestCover === "none") { bestCover = "half"; }
```

**Bug 3: Geometry check is over-restrictive for perpendicular cover**
- For a cover cell perpendicular to the attacker-target axis and adjacent to the target, the distance check may incorrectly exclude it.

### `hasLineOfSight()` — contrast
Uses ray-marching correctly: samples `steps = ceil(distance/gridSize)` points along the line, checks `cell.blocksLineOfSight`. This is the correct pattern that `getCoverLevel` should mirror.

### `setTerrainAt()` — important invariant
```typescript
blocksLineOfSight: terrain === "wall" || terrain === "cover-full",
passable: terrain !== "wall" && terrain !== "obstacle",
```
- Wall and cover-full set `blocksLineOfSight = true`
- Wall and obstacle are impassable

## Terrain→Cover Level Mapping (D&D 5e 2024)
| Terrain | Cover Level | Reason |
|---------|-------------|--------|
| `"wall"` | full | Blocks LOS completely — cannot be targeted |
| `"cover-full"` | full | Explicit full cover terrain |
| `"cover-three-quarters"` | three-quarters | PHB +5 AC |
| `"cover-half"` | half | PHB +2 AC |
| `"obstacle"` | half | Impassable obstruction ≥ half-cover per PHB |
| all others | none | No cover granted |

## Proposed Fix: Ray-March the Line

```typescript
export function getCoverLevel(map, attackerPos, targetPos): CoverLevel {
  const distance = calculateDistance(attackerPos, targetPos);
  const steps = Math.max(Math.ceil(distance / map.gridSize), 1);
  let bestCover: CoverLevel = "none";

  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const checkPos = {
      x: attackerPos.x + (targetPos.x - attackerPos.x) * t,
      y: attackerPos.y + (targetPos.y - attackerPos.y) * t,
    };
    const cell = getCellAt(map, checkPos);
    if (!cell) continue;

    const c = terrainToCoverLevel(cell.terrain);
    if (c === "full") return "full";
    if (c === "three-quarters" && bestCover !== "full") bestCover = "three-quarters";
    if (c === "half" && bestCover === "none") bestCover = "half";
  }
  return bestCover;
}
```

### Consistency with `hasLineOfSight`
| Aspect | hasLineOfSight | getCoverLevel (new) |
|--------|---------------|---------------------|
| Algorithm | ray-march steps | ray-march steps (same) |
| Steps | ceil(distance/gridSize) | ceil(distance/gridSize) (same) |
| Check | blocksLineOfSight flag | terrain → cover level |
| Skip endpoints | yes (i=1 to steps-1) | yes (i=1 to steps-1) |

## Risks
- **None**: Pure function replacement, same signature, same callers (`action-dispatcher.ts` line 2061, `save-spell-delivery-handler.ts` line 90). No integration changes needed.
- The test `"should detect cover from nearby obstacles"` currently uses `expect(["none", "half"]).toContain(cover)` — a weak acceptance of either value. New tests should be precise.

## Conclusion
**Self-contained, low-risk fix in a single file.** The new algorithm is strictly more correct — it handles cover anywhere on the attacker-target line, not just adjacent to the target.
