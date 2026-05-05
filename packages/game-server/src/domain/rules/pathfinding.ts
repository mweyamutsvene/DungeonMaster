/**
 * A* Pathfinding on the D&D 5e 5ft Grid
 *
 * Domain-pure pathfinding algorithm that operates on CombatMap terrain cells.
 * Handles:
 *  - Impassable terrain (walls, obstacles)
 *  - Difficult terrain (double movement cost)
 *  - Hazard avoidance (lava, pits — optional)
 *  - 8-directional movement with D&D 5e 2024 diagonal cost rules
 *  - Narration hints for path descriptions
 *  - Movement cost capping (stop when speed runs out)
 *  - Occupied position blocking (optional)
 *  - Finding the best adjacent cell to a target within a desired range
 */

import type { Position } from "./movement.js";
import { calculateDistance, snapToGrid } from "./movement.js";
import type { CombatMap, TerrainType } from "./combat-map.js";
import { getCellAt, isPositionPassable, isOnMap, getCreatureCellFootprint } from "./combat-map.js";
import type { CombatZone } from "../entities/combat/zones.js";
import { isPositionInZone } from "../entities/combat/zones.js";
import type { CreatureSize } from "../entities/core/types.js";

// ----------------------------------------------------------------
// Types
// ----------------------------------------------------------------

export interface PathOptions {
  /** Maximum movement cost in feet. Path stops when budget is exhausted. */
  maxCostFeet?: number;
  /** When true, treat hazard/lava/pit cells as impassable (default: true). */
  avoidHazards?: boolean;
  /** Positions occupied by other creatures — treated as impassable. */
  occupiedPositions?: Position[];
  /** Active combat zones — cells inside damaging zones get a cost penalty. */
  zones?: CombatZone[];
  /** Cost penalty (in feet) added per cell inside a damaging zone (default: 15). */
  zoneCostPenalty?: number;
  /** Size of the moving creature — Large+ creatures occupy multiple cells. */
  creatureSize?: CreatureSize;
}

/**
 * Per-cell metadata for rich path visualization.
 * Carries terrain type and movement costs so clients can render
 * animated tokens, trail overlays, and cost labels without
 * cross-referencing the full map grid.
 */
export interface PathCell {
  x: number;
  y: number;
  /** Terrain type at this cell. */
  terrain: TerrainType;
  /** Cost (in feet) to enter this specific cell (5, 10 for difficult, etc.). */
  stepCostFeet: number;
  /** Running total movement cost from start to this cell (inclusive). */
  cumulativeCostFeet: number;
}

export interface PathResult {
  /** Ordered positions from start (exclusive) to destination (inclusive). */
  path: Position[];
  /** Per-cell metadata for visualization (same order as `path`). */
  cells: PathCell[];
  /** Actual movement cost in feet (accounts for difficult terrain). */
  totalCostFeet: number;
  /** True if no path exists to the destination. */
  blocked: boolean;
  /** Terrain types encountered along the path. */
  terrainEncountered: TerrainType[];
  /** Human-readable hints for narration (e.g., "Detours around a wall"). */
  narrationHints: string[];
  /** The farthest reachable position if movement budget was exceeded. */
  reachablePosition?: Position;
}

/**
 * A single cell returned by {@link getReachableCells}.
 */
export interface ReachableCell {
  pos: Position;
  /** Actual movement cost (in feet) from the origin to this cell. */
  costFeet: number;
}

// ----------------------------------------------------------------
// Internal A* node
// ----------------------------------------------------------------

interface AStarNode {
  pos: Position;
  /** Cost from start to this node (in feet). */
  g: number;
  /** Heuristic estimate to goal (in feet). */
  h: number;
  /** f = g + h */
  f: number;
  parent: AStarNode | null;
  /** Terrain at this cell. */
  terrain: TerrainType;
  /** Running count of diagonal moves (for alternating cost). */
  diagonalCount: number;
}

// ----------------------------------------------------------------
// Constants
// ----------------------------------------------------------------

/** The eight cardinal + ordinal directions on a 5ft grid. */
const DIRECTIONS: Position[] = [
  { x: 5, y: 0 },   // E
  { x: -5, y: 0 },  // W
  { x: 0, y: 5 },   // S
  { x: 0, y: -5 },  // N
  { x: 5, y: 5 },   // SE
  { x: -5, y: 5 },  // SW
  { x: 5, y: -5 },  // NE
  { x: -5, y: -5 }, // NW
];

const HAZARD_TERRAINS: ReadonlySet<TerrainType> = new Set(["lava", "hazard", "pit"]);
const IMPASSABLE_TERRAINS: ReadonlySet<TerrainType> = new Set(["wall", "obstacle"]);

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function posKey(p: Position): string {
  return `${p.x},${p.y}`;
}

function isDiagonal(dx: number, dy: number): boolean {
  return dx !== 0 && dy !== 0;
}

/**
 * D&D 5e 2024 diagonal movement cost:
 * Every *other* diagonal costs 10ft instead of 5ft.
 * `diagonalCount` tracks how many diagonals have been taken so far.
 * Returns the step cost and the updated count.
 */
function diagonalStepCost(diagonalCount: number): { cost: number; newCount: number } {
  // Odd diagonal (1st, 3rd, …) = 5ft, even diagonal (2nd, 4th, …) = 10ft
  const isExpensive = diagonalCount % 2 === 1;
  return {
    cost: isExpensive ? 10 : 5,
    newCount: diagonalCount + 1,
  };
}

/**
 * Terrain cost multiplier.  Difficult terrain / water costs double.
 * Impassable terrain returns Infinity (caller should skip).
 */
function terrainCostMultiplier(terrain: TerrainType): number {
  switch (terrain) {
    case "difficult":
    case "water":
      return 2;
    case "wall":
    case "obstacle":
      return Infinity;
    default:
      return 1;
  }
}

/**
 * Chebyshev distance scaled to 5ft grid — admissible heuristic for D&D
 * alternating diagonal rule.  (Never overestimates.)
 */
function chebyshevHeuristic(from: Position, to: Position, gridSize: number): number {
  const dx = Math.abs(to.x - from.x) / gridSize;
  const dy = Math.abs(to.y - from.y) / gridSize;
  const diag = Math.min(dx, dy);
  const straight = Math.max(dx, dy) - diag;
  // Alternating cost: half diags cost 5, half cost 10 → avg 7.5 per diag
  // Use 5*straight + 5*diag as lower bound (admissible, never overestimates)
  return (straight + diag) * gridSize;
}

/**
 * Check if a single cell is walkable given options.
 */
function isSingleCellWalkable(
  map: CombatMap,
  pos: Position,
  avoidHazards: boolean,
  occupiedSet: Set<string>,
): boolean {
  if (!isOnMap(map, pos)) return false;
  const cell = getCellAt(map, pos);
  if (!cell) return false;
  if (!cell.passable) return false;
  if (IMPASSABLE_TERRAINS.has(cell.terrain)) return false;
  if (avoidHazards && HAZARD_TERRAINS.has(cell.terrain)) return false;
  if (occupiedSet.has(posKey(pos))) return false;
  return true;
}

/**
 * Check if a creature can stand at `pos` given its footprint size.
 * For single-cell creatures (Tiny/Small/Medium) this is the same as isSingleCellWalkable.
 * For Large+ creatures, checks all cells the creature would occupy.
 * A Large creature at (x,y) occupies (x,y), (x+g,y), (x,y+g), (x+g,y+g) where g=gridSize.
 */
function isCellWalkable(
  map: CombatMap,
  pos: Position,
  avoidHazards: boolean,
  occupiedSet: Set<string>,
  footprint: number = 1,
  gridSize: number = 5,
): boolean {
  if (footprint <= 1) {
    return isSingleCellWalkable(map, pos, avoidHazards, occupiedSet);
  }
  // Large+ creature: check all cells in the NxN footprint
  for (let dx = 0; dx < footprint; dx++) {
    for (let dy = 0; dy < footprint; dy++) {
      const cellPos: Position = { x: pos.x + dx * gridSize, y: pos.y + dy * gridSize };
      if (!isSingleCellWalkable(map, cellPos, avoidHazards, occupiedSet)) {
        return false;
      }
    }
  }
  return true;
}

// ----------------------------------------------------------------
// Public API
// ----------------------------------------------------------------

/**
 * Find the shortest path on the combat map using A*.
 *
 * @param map       The combat map with terrain cells.
 * @param from      Start position (feet, must be grid-aligned).
 * @param to        Goal position (feet, must be grid-aligned).
 * @param options   Movement budget, hazard avoidance, occupied positions.
 * @returns         PathResult with the path, cost, and narration hints.
 */
export function findPath(
  map: CombatMap,
  from: Position,
  to: Position,
  options: PathOptions = {},
): PathResult {
  const gridSize = map.gridSize || 5;
  const start = snapToGrid(from, gridSize);
  const goal = snapToGrid(to, gridSize);
  const avoidHazards = options.avoidHazards ?? true;
  const maxCost = options.maxCostFeet ?? Infinity;

  // Creature footprint: Large=2x2, Huge=3x3, Gargantuan=4x4, else 1x1
  const footprint = options.creatureSize ? getCreatureCellFootprint(options.creatureSize) : 1;

  const occupiedSet = new Set<string>();
  if (options.occupiedPositions) {
    for (const op of options.occupiedPositions) {
      const snapped = snapToGrid(op, gridSize);
      occupiedSet.add(posKey(snapped));
    }
  }
  // Goal cell itself is never blocked by "occupied" — you can move onto it
  occupiedSet.delete(posKey(goal));

  // Trivial: already at goal
  if (start.x === goal.x && start.y === goal.y) {
    return { path: [], cells: [], totalCostFeet: 0, blocked: false, terrainEncountered: [], narrationHints: [] };
  }

  // Goal itself impassable?
  if (!isCellWalkable(map, goal, avoidHazards, occupiedSet, footprint, gridSize)) {
    return {
      path: [],
      cells: [],
      totalCostFeet: 0,
      blocked: true,
      terrainEncountered: [],
      narrationHints: ["The destination is impassable."],
    };
  }

  // === A* ===
  const openMap = new Map<string, AStarNode>();
  const closedSet = new Set<string>();

  const startCell = getCellAt(map, start);
  const startNode: AStarNode = {
    pos: start,
    g: 0,
    h: chebyshevHeuristic(start, goal, gridSize),
    f: chebyshevHeuristic(start, goal, gridSize),
    parent: null,
    terrain: startCell?.terrain ?? "normal",
    diagonalCount: 0,
  };
  openMap.set(posKey(start), startNode);

  // Track the best reachable node within budget (in case we can't reach the goal)
  let bestReachable: AStarNode = startNode;

  while (openMap.size > 0) {
    // Pick node with lowest f-cost from open set
    let current: AStarNode | null = null;
    for (const node of openMap.values()) {
      if (!current || node.f < current.f || (node.f === current.f && node.h < current.h)) {
        current = node;
      }
    }
    if (!current) break;

    // Goal reached
    if (current.pos.x === goal.x && current.pos.y === goal.y) {
      return buildResult(current, start);
    }

    openMap.delete(posKey(current.pos));
    closedSet.add(posKey(current.pos));

    // Track best reachable node (closest to goal that's within budget)
    if (current.g <= maxCost && current.h < bestReachable.h) {
      bestReachable = current;
    }

    // Expand neighbors
    for (const dir of DIRECTIONS) {
      const neighbor: Position = { x: current.pos.x + dir.x, y: current.pos.y + dir.y };
      const nKey = posKey(neighbor);

      if (closedSet.has(nKey)) continue;
      if (!isCellWalkable(map, neighbor, avoidHazards, occupiedSet, footprint, gridSize)) continue;

      // Diagonal corner-cutting check: both adjacent orthogonal cells must be passable
      const diag = isDiagonal(dir.x, dir.y);
      if (diag) {
        const adj1: Position = { x: current.pos.x + dir.x, y: current.pos.y };
        const adj2: Position = { x: current.pos.x, y: current.pos.y + dir.y };
        if (!isCellWalkable(map, adj1, avoidHazards, occupiedSet, footprint, gridSize) ||
            !isCellWalkable(map, adj2, avoidHazards, occupiedSet, footprint, gridSize)) {
          continue; // Can't cut corners around walls
        }
      }

      // Calculate step cost
      const neighborCell = getCellAt(map, neighbor);
      const terrain = neighborCell?.terrain ?? "normal";
      const terrainMult = terrainCostMultiplier(terrain);
      if (terrainMult === Infinity) continue; // Impassable

      let stepCost: number;
      let newDiagCount = current.diagonalCount;
      if (diag) {
        const dc = diagonalStepCost(current.diagonalCount);
        stepCost = dc.cost * terrainMult;
        newDiagCount = dc.newCount;
      } else {
        stepCost = gridSize * terrainMult;
      }

      // Zone cost penalty — cells inside damaging zones are penalized
      if (options.zones && options.zones.length > 0) {
        const penalty = options.zoneCostPenalty ?? 15;
        for (const zone of options.zones) {
          if (isPositionInZone(zone, neighbor)) {
            stepCost += penalty;
            break; // One penalty per cell is enough
          }
        }
      }

      const newG = current.g + stepCost;

      // Over budget — don't expand (but node stays reachable via bestReachable tracking)
      if (newG > maxCost) continue;

      const existing = openMap.get(nKey);
      if (existing && newG >= existing.g) continue;

      const h = chebyshevHeuristic(neighbor, goal, gridSize);
      const node: AStarNode = {
        pos: neighbor,
        g: newG,
        h,
        f: newG + h,
        parent: current,
        terrain,
        diagonalCount: newDiagCount,
      };
      openMap.set(nKey, node);
    }
  }

  // No full path found — return the best reachable position within budget
  if (bestReachable !== startNode) {
    const partial = buildResult(bestReachable, start);
    return {
      ...partial,
      blocked: true,
      narrationHints: [...partial.narrationHints, "Cannot reach the destination — moving as far as possible."],
      reachablePosition: bestReachable.pos,
    };
  }

  return {
    path: [],
    cells: [],
    totalCostFeet: 0,
    blocked: true,
    terrainEncountered: [],
    narrationHints: ["No path exists to the destination."],
  };
}

/**
 * Find the best passable cell to stop at within `desiredRange` feet of `targetPos`,
 * choosing the cell closest to `approachFrom` (i.e. least backtracking).
 *
 * Cells in `occupiedPositions` are excluded so two creatures cannot pick the
 * same destination tile. The approach origin itself is never excluded.
 *
 * Returns null if no passable cell is in range.
 */
export function findAdjacentPosition(
  map: CombatMap,
  targetPos: Position,
  approachFrom: Position,
  desiredRange: number = 5,
  occupiedPositions?: readonly Position[],
): Position | null {
  const gridSize = map.gridSize || 5;
  const target = snapToGrid(targetPos, gridSize);
  const origin = snapToGrid(approachFrom, gridSize);

  const occupiedSet = new Set<string>();
  if (occupiedPositions) {
    for (const op of occupiedPositions) {
      occupiedSet.add(posKey(snapToGrid(op, gridSize)));
    }
  }
  // The approach origin is the moving creature's own cell — don't treat it
  // as occupied (otherwise an in-range creature can never "stay put").
  occupiedSet.delete(posKey(origin));

  // Simple case: if approach position is already within range, return it
  if (calculateDistance(origin, target) <= desiredRange) {
    return origin;
  }

  // Collect all passable cells within desiredRange of the target
  const candidates: Position[] = [];
  const searchRadius = Math.ceil(desiredRange / gridSize) + 1;

  for (let dx = -searchRadius; dx <= searchRadius; dx++) {
    for (let dy = -searchRadius; dy <= searchRadius; dy++) {
      const pos: Position = {
        x: target.x + dx * gridSize,
        y: target.y + dy * gridSize,
      };
      if (!isOnMap(map, pos)) continue;
      if (!isPositionPassable(map, pos)) continue;
      if (pos.x === target.x && pos.y === target.y) continue; // Don't stand on the target
      if (occupiedSet.has(posKey(pos))) continue; // Skip cells held by other live combatants

      const distToTarget = calculateDistance(pos, target);
      if (distToTarget <= desiredRange) {
        candidates.push(pos);
      }
    }
  }

  if (candidates.length === 0) return null;

  // Pick the candidate closest to the approach origin (least total travel)
  candidates.sort((a, b) => calculateDistance(a, origin) - calculateDistance(b, origin));
  return candidates[0]!;
}

/**
 * Flood-fill all cells reachable from `from` within `maxCostFeet` using Dijkstra.
 *
 * Uses the same movement rules as {@link findPath}: difficult terrain ×2,
 * diagonal alternating cost, hazard avoidance, occupied position blocking,
 * and zone cost penalties. Returns EVERY cell reachable within the budget —
 * including the origin cell at cost 0.
 *
 * This is the foundation for {@link findRetreatPosition} and any other AI
 * logic that needs the actual set of reachable cells (not a Euclidean estimate).
 *
 * @param map         Combat map with terrain cells.
 * @param from        Start position (grid-aligned).
 * @param maxCostFeet Movement budget in feet.
 * @param options     Hazard avoidance, occupied positions, zones.
 * @returns           All cells reachable within budget, in expansion order.
 */
export function getReachableCells(
  map: CombatMap,
  from: Position,
  maxCostFeet: number,
  options: Omit<PathOptions, "maxCostFeet"> = {},
): ReachableCell[] {
  const gridSize = map.gridSize || 5;
  const start = snapToGrid(from, gridSize);
  const avoidHazards = options.avoidHazards ?? true;

  // Creature footprint for Large+ creatures
  const footprint = options.creatureSize ? getCreatureCellFootprint(options.creatureSize) : 1;

  const occupiedSet = new Set<string>();
  if (options.occupiedPositions) {
    for (const op of options.occupiedPositions) {
      occupiedSet.add(posKey(snapToGrid(op, gridSize)));
    }
  }
  // Start cell is never blocked by the occupied check (creature is already there).
  occupiedSet.delete(posKey(start));

  interface FloodNode {
    pos: Position;
    g: number;
    diagonalCount: number;
  }

  const openMap = new Map<string, FloodNode>();
  const closedSet = new Set<string>();
  const result: ReachableCell[] = [];

  openMap.set(posKey(start), { pos: start, g: 0, diagonalCount: 0 });

  while (openMap.size > 0) {
    // Pick node with lowest g-cost (Dijkstra — no heuristic needed for flood-fill)
    let current: FloodNode | null = null;
    for (const node of openMap.values()) {
      if (!current || node.g < current.g) {
        current = node;
      }
    }
    if (!current) break;

    const currentKey = posKey(current.pos);
    openMap.delete(currentKey);
    if (closedSet.has(currentKey)) continue;
    closedSet.add(currentKey);
    result.push({ pos: current.pos, costFeet: current.g });

    for (const dir of DIRECTIONS) {
      const neighbor: Position = { x: current.pos.x + dir.x, y: current.pos.y + dir.y };
      const nKey = posKey(neighbor);

      if (closedSet.has(nKey)) continue;
      if (!isCellWalkable(map, neighbor, avoidHazards, occupiedSet, footprint, gridSize)) continue;

      // Diagonal corner-cutting check: both orthogonal neighbours must be passable
      const diag = isDiagonal(dir.x, dir.y);
      if (diag) {
        const adj1: Position = { x: current.pos.x + dir.x, y: current.pos.y };
        const adj2: Position = { x: current.pos.x, y: current.pos.y + dir.y };
        if (!isCellWalkable(map, adj1, avoidHazards, occupiedSet, footprint, gridSize) ||
            !isCellWalkable(map, adj2, avoidHazards, occupiedSet, footprint, gridSize)) {
          continue;
        }
      }

      const neighborCell = getCellAt(map, neighbor);
      const terrain = neighborCell?.terrain ?? "normal";
      const terrainMult = terrainCostMultiplier(terrain);
      if (terrainMult === Infinity) continue;

      let stepCost: number;
      let newDiagCount = current.diagonalCount;
      if (diag) {
        const dc = diagonalStepCost(current.diagonalCount);
        stepCost = dc.cost * terrainMult;
        newDiagCount = dc.newCount;
      } else {
        stepCost = gridSize * terrainMult;
      }

      // Zone cost penalty — cells inside damaging zones are penalised
      if (options.zones && options.zones.length > 0) {
        const penalty = options.zoneCostPenalty ?? 15;
        for (const zone of options.zones) {
          if (isPositionInZone(zone, neighbor)) {
            stepCost += penalty;
            break;
          }
        }
      }

      const newG = current.g + stepCost;
      if (newG > maxCostFeet) continue;

      const existing = openMap.get(nKey);
      if (!existing || newG < existing.g) {
        openMap.set(nKey, { pos: neighbor, g: newG, diagonalCount: newDiagCount });
      }
    }
  }

  return result;
}

/**
 * Find the best retreat destination: the passable cell within movement range
 * that maximises distance from `fleeFrom`.
 *
 * Uses Dijkstra flood-fill (via {@link getReachableCells}) to enumerate all
 * cells truly reachable within `speedFeet`, then picks the one farthest from
 * the threat. Cells in damaging zones are excluded as end positions. Falls
 * back to the current position (stay put) when no better cell can be reached.
 * Falls back to linear interpolation when no combat map is available
 * (`map: undefined`).
 */
export function findRetreatPosition(
  map: CombatMap | undefined,
  currentPos: Position,
  fleeFrom: Position,
  speedFeet: number,
  occupiedPositions?: Position[],
  zones?: CombatZone[],
): Position {
  if (!map) {
    // No map: move linearly away from threat, clamped to speed
    const dx = currentPos.x - fleeFrom.x;
    const dy = currentPos.y - fleeFrom.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist === 0) {
      // Exactly overlapping — pick an arbitrary direction (positive X)
      return { x: currentPos.x + speedFeet, y: currentPos.y };
    }
    const ratio = speedFeet / dist;
    return {
      x: Math.round(currentPos.x + dx * ratio),
      y: Math.round(currentPos.y + dy * ratio),
    };
  }

  const gridSize = map.gridSize || 5;
  const origin = snapToGrid(currentPos, gridSize);
  const threat = snapToGrid(fleeFrom, gridSize);

  // Use Dijkstra flood-fill to get cells truly reachable within speedFeet.
  // This respects walls, difficult terrain, and diagonal cost rules — unlike
  // a plain Euclidean-distance filter which incorrectly marks cells behind
  // walls or reachable only via expensive detours as "in range".
  const reachable = getReachableCells(map, origin, speedFeet, { occupiedPositions, zones });

  let bestPos = origin;
  let bestDist = calculateDistance(origin, threat);

  for (const { pos } of reachable) {
    if (pos.x === origin.x && pos.y === origin.y) continue; // Don't count staying put

    // Skip cells in damaging zones — don't end a retreat inside a hazard area
    if (zones) {
      const inDangerousZone = zones.some(z =>
        z.effects.some(e => e.trigger === "on_enter" || e.trigger === "per_5ft_moved") &&
        isPositionInZone(z, pos),
      );
      if (inDangerousZone) continue;
    }

    const distFromThreat = calculateDistance(pos, threat);
    if (distFromThreat > bestDist) {
      bestDist = distFromThreat;
      bestPos = pos;
    }
  }

  return bestPos;
}

// ----------------------------------------------------------------
// Internal helpers
// ----------------------------------------------------------------

/**
 * Reconstruct the path from a goal node back to start.
 * Generates narration hints from terrain transitions.
 */
function buildResult(goalNode: AStarNode, start: Position): PathResult {
  const reversePath: AStarNode[] = [];
  let node: AStarNode | null = goalNode;
  while (node && !(node.pos.x === start.x && node.pos.y === start.y)) {
    reversePath.push(node);
    node = node.parent;
  }
  reversePath.reverse();

  const path = reversePath.map(n => n.pos);

  // Build per-cell metadata for rich client visualization
  const cells: PathCell[] = reversePath.map((n, i) => {
    const prevG = i === 0 ? 0 : reversePath[i - 1].g;
    return {
      x: n.pos.x,
      y: n.pos.y,
      terrain: n.terrain,
      stepCostFeet: n.g - prevG,
      cumulativeCostFeet: n.g,
    };
  });

  const terrainEncountered: TerrainType[] = [];
  const narrationHints: string[] = [];

  // Deduplicate terrain encounters for narration
  const seenDifficult = new Set<string>();
  let detoured = false;

  for (const n of reversePath) {
    if (n.terrain !== "normal" && !terrainEncountered.includes(n.terrain)) {
      terrainEncountered.push(n.terrain);
    }

    if ((n.terrain === "difficult" || n.terrain === "water") && !seenDifficult.has(n.terrain)) {
      seenDifficult.add(n.terrain);
      if (n.terrain === "difficult") {
        narrationHints.push("Crossing difficult terrain — movement slowed.");
      } else {
        narrationHints.push("Wading through water — movement slowed.");
      }
    }
  }

  // Detect detour: if the path isn't roughly straight-line, it routed around something
  if (path.length > 0) {
    const straightDist = calculateDistance(start, goalNode.pos);
    const pathDist = goalNode.g;
    // If path cost is significantly more than straight-line, we detoured
    if (pathDist > straightDist * 1.3 && pathDist > straightDist + 5) {
      detoured = true;
      narrationHints.push("The direct path is blocked — taking a detour.");
    }
  }

  return {
    path,
    cells,
    totalCostFeet: goalNode.g,
    blocked: false,
    terrainEncountered,
    narrationHints,
  };
}
