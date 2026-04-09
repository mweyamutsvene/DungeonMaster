import { describe, expect, it } from "vitest";
import { findPath, findAdjacentPosition, findRetreatPosition, getReachableCells } from "./pathfinding.js";
import { createCombatMap, setTerrainAt, type CombatMap } from "./combat-map.js";

/**
 * Helper: create a small 50×50ft (10×10 cells) map for tests.
 */
function makeMap(width = 50, height = 50): CombatMap {
  return createCombatMap({ id: "test", name: "Test", width, height, gridSize: 5 });
}

/**
 * Helper: place a wall across a row of cells.
 */
function addWallRow(map: CombatMap, y: number, xStart: number, xEnd: number): CombatMap {
  let m = map;
  for (let x = xStart; x <= xEnd; x += 5) {
    m = setTerrainAt(m, { x, y }, "wall");
  }
  return m;
}

/**
 * Helper: place difficult terrain across a row of cells.
 */
function addDifficultRow(map: CombatMap, y: number, xStart: number, xEnd: number): CombatMap {
  let m = map;
  for (let x = xStart; x <= xEnd; x += 5) {
    m = setTerrainAt(m, { x, y }, "difficult");
  }
  return m;
}

describe("Pathfinding — findPath", () => {
  it("should find a straight-line path on an open map", () => {
    const map = makeMap();
    const result = findPath(map, { x: 0, y: 0 }, { x: 20, y: 0 });

    expect(result.blocked).toBe(false);
    expect(result.path.length).toBeGreaterThan(0);
    expect(result.totalCostFeet).toBe(20);
    // Path should end at destination
    expect(result.path[result.path.length - 1]).toEqual({ x: 20, y: 0 });
  });

  it("should return empty path when start equals goal", () => {
    const map = makeMap();
    const result = findPath(map, { x: 10, y: 10 }, { x: 10, y: 10 });

    expect(result.blocked).toBe(false);
    expect(result.path).toEqual([]);
    expect(result.totalCostFeet).toBe(0);
  });

  it("should route around a wall", () => {
    let map = makeMap();
    // Wall at y=10 from x=0 to x=20 — blocks direct east-west movement
    map = addWallRow(map, 10, 0, 20);

    // Try to go from (10, 5) to (10, 15) — wall blocks straight path at y=10
    const result = findPath(map, { x: 10, y: 5 }, { x: 10, y: 15 });

    expect(result.blocked).toBe(false);
    expect(result.path.length).toBeGreaterThan(0);
    // Path cost should be more than 10ft (straight line) due to detour
    expect(result.totalCostFeet).toBeGreaterThan(10);
    // Path end should be the destination
    expect(result.path[result.path.length - 1]).toEqual({ x: 10, y: 15 });
    // Narration should mention a detour
    expect(result.narrationHints.some(h => h.toLowerCase().includes("detour") || h.toLowerCase().includes("blocked"))).toBe(true);
  });

  it("should account for difficult terrain cost when forced through it", () => {
    let map = makeMap();
    // Fill difficult terrain in a wide band so A* cannot route around it
    // Difficult terrain from x=10 to x=15, y=-5 to y=45 (whole width of useful area)
    for (let y = 0; y <= 45; y += 5) {
      map = addDifficultRow(map, y, 10, 15);
    }

    // Path from (0, 0) to (25, 0) must cross the difficult band
    const result = findPath(map, { x: 0, y: 0 }, { x: 25, y: 0 });

    expect(result.blocked).toBe(false);
    // At minimum, path crosses 2 difficult cells (10ft each) + 3 normal cells (5ft each)
    // = 20 + 15 = 35ft if going straight through
    expect(result.totalCostFeet).toBeGreaterThan(25);
    expect(result.terrainEncountered).toContain("difficult");
    expect(result.narrationHints.some(h => h.toLowerCase().includes("difficult"))).toBe(true);
  });

  it("should prefer detouring around difficult terrain when cheaper", () => {
    let map = makeMap();
    // Small patch of difficult terrain — A* may route around it
    map = setTerrainAt(map, { x: 10, y: 0 }, "difficult");
    map = setTerrainAt(map, { x: 15, y: 0 }, "difficult");

    const result = findPath(map, { x: 0, y: 0 }, { x: 20, y: 0 });

    expect(result.blocked).toBe(false);
    // A* should find a path that costs ≤ 30ft (the through-difficult cost)
    // Detour via diagonal may be cheaper
    expect(result.totalCostFeet).toBeLessThanOrEqual(30);
  });

  it("should report blocked when no path exists", () => {
    let map = makeMap();
    // Surround destination with walls
    map = setTerrainAt(map, { x: 15, y: 20 }, "wall");
    map = setTerrainAt(map, { x: 25, y: 20 }, "wall");
    map = setTerrainAt(map, { x: 20, y: 15 }, "wall");
    map = setTerrainAt(map, { x: 20, y: 25 }, "wall");
    // Diagonals too
    map = setTerrainAt(map, { x: 15, y: 15 }, "wall");
    map = setTerrainAt(map, { x: 25, y: 15 }, "wall");
    map = setTerrainAt(map, { x: 15, y: 25 }, "wall");
    map = setTerrainAt(map, { x: 25, y: 25 }, "wall");

    const result = findPath(map, { x: 0, y: 0 }, { x: 20, y: 20 });

    expect(result.blocked).toBe(true);
  });

  it("should report blocked when destination is impassable", () => {
    let map = makeMap();
    map = setTerrainAt(map, { x: 20, y: 20 }, "wall");

    const result = findPath(map, { x: 0, y: 0 }, { x: 20, y: 20 });

    expect(result.blocked).toBe(true);
    expect(result.narrationHints).toContain("The destination is impassable.");
  });

  it("should respect maxCostFeet budget", () => {
    const map = makeMap();
    // Try to go 30ft but budget is only 15ft
    const result = findPath(map, { x: 0, y: 0 }, { x: 30, y: 0 }, { maxCostFeet: 15 });

    expect(result.blocked).toBe(true);
    // Should have a reachable position partway
    expect(result.reachablePosition).toBeDefined();
    // Reachable position should be within budget
    expect(result.totalCostFeet).toBeLessThanOrEqual(15);
    expect(result.narrationHints.some(h => h.includes("as far as possible"))).toBe(true);
  });

  it("should avoid hazards by default", () => {
    let map = makeMap();
    // Lava at y=0 from x=10 to x=15 — blocks the direct path
    map = setTerrainAt(map, { x: 10, y: 0 }, "lava");
    map = setTerrainAt(map, { x: 15, y: 0 }, "lava");

    const result = findPath(map, { x: 0, y: 0 }, { x: 25, y: 0 });

    expect(result.blocked).toBe(false);
    // Path should not go through lava
    for (const pos of result.path) {
      expect(pos).not.toEqual({ x: 10, y: 0 });
      expect(pos).not.toEqual({ x: 15, y: 0 });
    }
    // Should have detoured
    expect(result.totalCostFeet).toBeGreaterThan(25);
  });

  it("should walk through hazards when avoidHazards is false", () => {
    let map = makeMap();
    map = setTerrainAt(map, { x: 10, y: 0 }, "lava");
    map = setTerrainAt(map, { x: 15, y: 0 }, "lava");

    const result = findPath(map, { x: 0, y: 0 }, { x: 25, y: 0 }, { avoidHazards: false });

    expect(result.blocked).toBe(false);
    // Should take the direct path through lava (cheaper than detouring)
    expect(result.totalCostFeet).toBe(25);
  });

  it("should treat occupied positions as impassable", () => {
    const map = makeMap();
    // Block straight path with occupied positions
    const occupied = [{ x: 10, y: 0 }, { x: 10, y: 5 }];

    const result = findPath(map, { x: 0, y: 0 }, { x: 20, y: 0 }, { occupiedPositions: occupied });

    expect(result.blocked).toBe(false);
    // Path should not go through occupied cells
    for (const pos of result.path) {
      expect(occupied.some(o => o.x === pos.x && o.y === pos.y)).toBe(false);
    }
  });

  it("should handle diagonal movement cost correctly", () => {
    const map = makeMap();
    // Move diagonally: (0,0) → (5,5) → (10,10)
    const result = findPath(map, { x: 0, y: 0 }, { x: 10, y: 10 });

    expect(result.blocked).toBe(false);
    // Two diagonal moves: 1st diagonal = 5ft, 2nd diagonal = 10ft. Total = 15ft
    expect(result.totalCostFeet).toBe(15);
  });

  it("should prevent corner-cutting through walls", () => {
    let map = makeMap();
    // Place a wall at (5, 0) so you can't cut diagonally from (0,0) to (5,5) via the (5,0) corner
    map = setTerrainAt(map, { x: 5, y: 0 }, "wall");

    const result = findPath(map, { x: 0, y: 0 }, { x: 10, y: 0 });

    expect(result.blocked).toBe(false);
    // Path must go around the wall — not through (5,0)
    for (const pos of result.path) {
      expect(pos).not.toEqual({ x: 5, y: 0 });
    }
  });

  it("should snap non-grid-aligned positions to grid", () => {
    const map = makeMap();
    // Positions not on grid — should snap
    const result = findPath(map, { x: 2, y: 3 }, { x: 18, y: 2 });

    expect(result.blocked).toBe(false);
    // Snapped: (2,3) → (0,5), (18,2) → (20,0)  
    // Actually snapToGrid rounds: 2/5=0.4→0, 3/5=0.6→5. 18/5=3.6→4*5=20, 2/5=0.4→0
    expect(result.path[result.path.length - 1]).toEqual({ x: 20, y: 0 });
  });
});

describe("Pathfinding — findAdjacentPosition", () => {
  it("should return a cell adjacent to the target", () => {
    const map = makeMap();
    const result = findAdjacentPosition(map, { x: 20, y: 20 }, { x: 0, y: 20 }, 5);

    expect(result).not.toBeNull();
    // Should be within 5ft of target (Chebyshev distance — D&D grid)
    const dx = Math.abs(result!.x - 20);
    const dy = Math.abs(result!.y - 20);
    const dist = Math.max(dx, dy);
    expect(dist).toBeLessThanOrEqual(5); // Chebyshev: diagonal = 5ft
    // Should be on the west side of target (x < 20), adjacent
    expect(result!.x).toBe(15);
  });

  it("should return approach position if already in range", () => {
    const map = makeMap();
    const result = findAdjacentPosition(map, { x: 20, y: 20 }, { x: 20, y: 25 }, 5);

    // (20,25) is 5ft from (20,20) — already in range
    expect(result).toEqual({ x: 20, y: 25 });
  });

  it("should find alternative cell when preferred cell is blocked", () => {
    let map = makeMap();
    // Block the west side of target at (20, 20)
    map = setTerrainAt(map, { x: 15, y: 20 }, "wall");

    const result = findAdjacentPosition(map, { x: 20, y: 20 }, { x: 0, y: 20 }, 5);

    expect(result).not.toBeNull();
    // Should NOT be the blocked cell
    expect(result).not.toEqual({ x: 15, y: 20 });
    // Should still be within 5ft of target (Chebyshev distance)
    const dx = Math.abs(result!.x - 20);
    const dy = Math.abs(result!.y - 20);
    const dist = Math.max(dx, dy);
    expect(dist).toBeLessThanOrEqual(5.1); // Chebyshev: diagonal = 5ft
  });

  it("should return null when all adjacent cells are blocked", () => {
    let map = makeMap();
    // Surround (20, 20) with walls on all 8 sides
    for (const dx of [-5, 0, 5]) {
      for (const dy of [-5, 0, 5]) {
        if (dx === 0 && dy === 0) continue;
        map = setTerrainAt(map, { x: 20 + dx, y: 20 + dy }, "wall");
      }
    }

    const result = findAdjacentPosition(map, { x: 20, y: 20 }, { x: 0, y: 20 }, 5);
    expect(result).toBeNull();
  });

  it("should find cells within a larger desired range", () => {
    const map = makeMap();
    const result = findAdjacentPosition(map, { x: 30, y: 30 }, { x: 0, y: 30 }, 15);

    expect(result).not.toBeNull();
    const dx = Math.abs(result!.x - 30);
    const dy = Math.abs(result!.y - 30);
    const dist = Math.max(dx, dy); // Chebyshev distance
    expect(dist).toBeLessThanOrEqual(15.1);
    // Should pick the cell closest to approach origin
    expect(result!.x).toBeLessThan(30);
  });
});

// ----------------------------------------------------------------
// getReachableCells
// ----------------------------------------------------------------

describe("Pathfinding — getReachableCells", () => {
  it("should include the origin cell at cost 0", () => {
    const map = makeMap();
    const cells = getReachableCells(map, { x: 0, y: 0 }, 30);

    const origin = cells.find(c => c.pos.x === 0 && c.pos.y === 0);
    expect(origin).toBeDefined();
    expect(origin!.costFeet).toBe(0);
  });

  it("should return cells within the movement budget on an open map", () => {
    const map = makeMap();
    const budget = 20;
    const cells = getReachableCells(map, { x: 0, y: 0 }, budget);

    // All returned cells must have actual path cost ≤ budget
    for (const cell of cells) {
      expect(cell.costFeet).toBeLessThanOrEqual(budget);
    }

    // Cells within 20ft straight east should be reachable
    expect(cells.some(c => c.pos.x === 20 && c.pos.y === 0)).toBe(true);

    // Cell at 25ft east should NOT be reachable within 20ft budget
    expect(cells.some(c => c.pos.x === 25 && c.pos.y === 0)).toBe(false);
  });

  it("should NOT include cells behind a wall that would require a detour exceeding the budget", () => {
    // Wall column at x=10 from y=0 to y=20 (blocks direct eastward path)
    let map = makeMap(100, 100);
    for (let y = 0; y <= 20; y += 5) {
      map = setTerrainAt(map, { x: 10, y }, "wall");
    }
    // From (0,0) with a 15ft budget, cell at (15,10) requires going around the wall
    // — minimum path cost exceeds 15ft, so it should NOT appear in the reachable set.
    const cells = getReachableCells(map, { x: 0, y: 0 }, 15);
    const beyondWall = cells.find(c => c.pos.x === 15 && c.pos.y === 10);
    expect(beyondWall).toBeUndefined();
  });

  it("should include cells reachable by routing around a wall when budget allows", () => {
    let map = makeMap(100, 100);
    // Wall column at x=10 from y=0..y=10 (partial wall, can go around from y=15)
    for (let y = 0; y <= 10; y += 5) {
      map = setTerrainAt(map, { x: 10, y }, "wall");
    }
    // With a 60ft budget, cell at (15,0) should be reachable via detour
    const cells = getReachableCells(map, { x: 0, y: 0 }, 60);
    expect(cells.some(c => c.pos.x === 15 && c.pos.y === 0)).toBe(true);
  });

  it("should not include occupied positions", () => {
    const map = makeMap();
    const occupied = [{ x: 5, y: 0 }, { x: 0, y: 5 }];
    const cells = getReachableCells(map, { x: 0, y: 0 }, 30, { occupiedPositions: occupied });

    expect(cells.find(c => c.pos.x === 5 && c.pos.y === 0)).toBeUndefined();
    expect(cells.find(c => c.pos.x === 0 && c.pos.y === 5)).toBeUndefined();
  });

  it("should account for difficult terrain cost", () => {
    let map = makeMap();
    // Difficult terrain at (5,0) — costs 10ft instead of 5ft
    map = setTerrainAt(map, { x: 5, y: 0 }, "difficult");

    const cells = getReachableCells(map, { x: 0, y: 0 }, 10);
    // (5,0) costs 10ft — exactly at budget, should be included
    const difficultCell = cells.find(c => c.pos.x === 5 && c.pos.y === 0);
    expect(difficultCell).toBeDefined();
    expect(difficultCell!.costFeet).toBe(10);
    // (10,0) costs 10 + 5 = 15ft via (5,0), but direct from (0,0) costs 10ft — wait,
    // (10,0) from origin without going through (5,0) directly isn't possible.
    // Path must go through (5,0) = 10ft, then to (10,0) = 10+5 = 15ft.
    // 15ft > 10ft budget → (10,0) should NOT be reachable.
    expect(cells.find(c => c.pos.x === 10 && c.pos.y === 0)).toBeUndefined();
  });
});

// ----------------------------------------------------------------
// findRetreatPosition
// ----------------------------------------------------------------

describe("Pathfinding — findRetreatPosition", () => {
  it("should move away from the threat on an open map", () => {
    const map = makeMap(200, 100);
    // Creature at (50,25), threat at (75,25) — retreat westward
    const result = findRetreatPosition(map, { x: 50, y: 25 }, { x: 75, y: 25 }, 30);

    // Result should be further west (lower x) and at least as far as origin
    const distOrigin = Math.abs(75 - 50); // 25ft
    const distResult = Math.abs(75 - result.x);
    expect(distResult).toBeGreaterThan(distOrigin);
    // Result must be within 30ft movement (pathfinding cost — not Euclidean)
    expect(result.x).toBeGreaterThanOrEqual(20); // not further than 30ft west
  });

  it("should NOT pick a cell behind a wall that would require a detour exceeding speed", () => {
    // Wall column at x=40 blocks direct westward retreat
    let map = makeMap(200, 100);
    for (let y = 0; y <= 95; y += 5) {
      map = setTerrainAt(map, { x: 40, y }, "wall");
    }
    // Creature at (50,25), threat at (80,25), speed=15ft
    // With a 15ft budget, cannot cross the wall at x=40 (would need 10ft to reach wall side + 5ft through = impossible)
    // The best reachable retreat within 15ft should be on the east side of the wall (x≥45)
    const result = findRetreatPosition(map, { x: 50, y: 25 }, { x: 80, y: 25 }, 15);

    // Result must NOT be west of the wall (x<40)
    expect(result.x).toBeGreaterThanOrEqual(40);
    // Result must be different from origin (we can still move within 15ft on the east side)
    // (could go north/south to increase distance from (80,25))
  });

  it("should return current position when surrounded (no better cell reachable)", () => {
    // Small 2x2 room (all surrounding cells are walls)
    let map = makeMap(50, 50);
    const room = [
      { x: 20, y: 20 }, // origin
    ];
    // Surround origin with walls on all 8 sides
    for (const dx of [-5, 0, 5]) {
      for (const dy of [-5, 0, 5]) {
        if (dx === 0 && dy === 0) continue;
        map = setTerrainAt(map, { x: 20 + dx, y: 20 + dy }, "wall");
      }
    }
    void room; // suppress unused warning

    // Creature at (20,20), completely surrounded by walls, threat at (30,20)
    const result = findRetreatPosition(map, { x: 20, y: 20 }, { x: 30, y: 20 }, 30);

    // Can't go anywhere — should stay at origin
    expect(result).toEqual({ x: 20, y: 20 });
  });

  it("should fall back to linear interpolation when no map is provided", () => {
    // No map — uses linear interpolation
    const result = findRetreatPosition(undefined, { x: 50, y: 25 }, { x: 75, y: 25 }, 30);

    // Linear retreat: dx = 50-75=-25, dy=0, dist=25, ratio=30/25=1.2
    // result.x = round(50 + (-25)*1.2) = round(50-30) = 20
    expect(result.x).toBe(20);
    expect(result.y).toBe(25);
  });

  it("should use pathfinding cost (not Euclidean) for reachability on difficult terrain", () => {
    // Fill a band with difficult terrain at x=10..20 across all y
    let map = makeMap(200, 100);
    for (let y = 0; y <= 95; y += 5) {
      map = setTerrainAt(map, { x: 10, y }, "difficult");
      map = setTerrainAt(map, { x: 15, y }, "difficult");
      map = setTerrainAt(map, { x: 20, y }, "difficult");
    }
    // Creature at (25,25), threat at (50,25), speed=15ft
    // Cells at x=0,5 require going through 3 difficult cells (each 10ft) = 30ft total
    // That exceeds 15ft budget, so those cells should NOT be returned as retreat destination.
    const result = findRetreatPosition(map, { x: 25, y: 25 }, { x: 50, y: 25 }, 15);

    // Result must NOT be in the unreachable zone west of difficult band (x<10)
    // because 3 difficult cells × 10ft = 30ft > 15ft budget
    // (cells at x=10,15,20 are difficult but might be within budget depending on path)
    // Most importantly, x=0 or x=5 should NOT be the result
    expect(result.x).toBeGreaterThan(5);
  });
});
