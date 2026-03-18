import { describe, expect, it } from "vitest";
import { findPath, findAdjacentPosition } from "./pathfinding.js";
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
    // Should be within 5ft of target
    const dx = Math.abs(result!.x - 20);
    const dy = Math.abs(result!.y - 20);
    const dist = Math.sqrt(dx * dx + dy * dy);
    expect(dist).toBeLessThanOrEqual(5.1); // small tolerance
    // Should be the cell closest to approach direction (west side)
    expect(result!.x).toBe(15);
    expect(result!.y).toBe(20);
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
    // Should still be within 5ft of target
    const dx = Math.abs(result!.x - 20);
    const dy = Math.abs(result!.y - 20);
    const dist = Math.sqrt(dx * dx + dy * dy);
    expect(dist).toBeLessThanOrEqual(7.1 + 0.1); // diagonal = ~7.07ft from center
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
    const dist = Math.sqrt(dx * dx + dy * dy);
    expect(dist).toBeLessThanOrEqual(15.1);
    // Should pick the cell closest to approach origin
    expect(result!.x).toBeLessThan(30);
  });
});
