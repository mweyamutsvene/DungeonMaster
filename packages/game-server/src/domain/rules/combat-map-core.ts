/**
 * D&D 5e Combat Map Core Operations
 *
 * Core map factory, cell access, terrain mutation, entity CRUD, passability, and
 * terrain speed modifiers. Stateless pure functions — all return new map objects.
 * Part of the combat-map module family — see combat-map.ts for the re-export barrel.
 */

import type { Position } from "./movement.js";
import { calculateDistance } from "./movement.js";
import type { CombatMap, MapCell, MapEntity, TerrainType } from "./combat-map-types.js";
import type { DiceRoller } from "./dice-roller.js";

export interface TerrainCellOptions {
  terrainElevation?: number;
  terrainDepth?: number;
}

/**
 * Create a new combat map with default terrain.
 */
export function createCombatMap(options: {
  id: string;
  name: string;
  width: number;
  height: number;
  gridSize?: number;
  description?: string;
}): CombatMap {
  const gridSize = options.gridSize ?? 5;
  const cells: MapCell[] = [];

  // Initialize all cells as normal terrain
  for (let x = 0; x < options.width; x += gridSize) {
    for (let y = 0; y < options.height; y += gridSize) {
      cells.push({
        position: { x, y },
        terrain: "normal",
        blocksLineOfSight: false,
        passable: true,
      });
    }
  }

  return {
    id: options.id,
    name: options.name,
    width: options.width,
    height: options.height,
    gridSize,
    cells,
    entities: [],
    description: options.description,
  };
}

/**
 * Get cell at a specific position (or nearest cell).
 */
export function getCellAt(map: CombatMap, position: Position): MapCell | null {
  // Find exact match or nearest cell
  const gridX = Math.round(position.x / map.gridSize) * map.gridSize;
  const gridY = Math.round(position.y / map.gridSize) * map.gridSize;

  return map.cells.find(c => c.position.x === gridX && c.position.y === gridY) ?? null;
}

/**
 * Set terrain type for a cell.
 */
export function setTerrainAt(
  map: CombatMap,
  position: Position,
  terrain: TerrainType,
  options?: TerrainCellOptions,
): CombatMap {
  const cell = getCellAt(map, position);
  if (!cell) return map;

  const updatedCells = map.cells.map(c =>
    c.position.x === cell.position.x && c.position.y === cell.position.y
      ? {
          ...c,
          terrain,
          terrainElevation: terrain === "elevated"
            ? options?.terrainElevation ?? c.terrainElevation ?? 0
            : undefined,
          terrainDepth: terrain === "pit"
            ? options?.terrainDepth ?? c.terrainDepth ?? 0
            : undefined,
          blocksLineOfSight: terrain === "wall" || terrain === "cover-full",
          passable: terrain !== "wall" && terrain !== "obstacle",
        }
      : c,
  );

  return { ...map, cells: updatedCells };
}

/**
 * Add an entity to the map.
 */
export function addEntity(map: CombatMap, entity: MapEntity): CombatMap {
  return {
    ...map,
    entities: [...map.entities, entity],
  };
}

/**
 * Update entity position on the map.
 */
export function moveEntity(map: CombatMap, entityId: string, newPosition: Position): CombatMap {
  const updatedEntities = map.entities.map(e =>
    e.id === entityId ? { ...e, position: newPosition } : e,
  );

  return { ...map, entities: updatedEntities };
}

/**
 * Remove entity from the map.
 */
export function removeEntity(map: CombatMap, entityId: string): CombatMap {
  return {
    ...map,
    entities: map.entities.filter(e => e.id !== entityId),
  };
}

/**
 * Get entity by ID.
 */
export function getEntity(map: CombatMap, entityId: string): MapEntity | null {
  return map.entities.find(e => e.id === entityId) ?? null;
}

/**
 * Get all entities at a position.
 */
export function getEntitiesAt(map: CombatMap, position: Position, range: number = 2.5): MapEntity[] {
  return map.entities.filter(e => calculateDistance(e.position, position) <= range);
}

/**
 * Get all creatures on the map.
 */
export function getCreatures(map: CombatMap): MapEntity[] {
  return map.entities.filter(e => e.type === "creature");
}

/**
 * Get all items/objects on the map.
 */
export function getItems(map: CombatMap): MapEntity[] {
  return map.entities.filter(e => e.type === "item" || e.type === "object");
}

/**
 * Check if a position is on the map.
 */
export function isOnMap(map: CombatMap, position: Position): boolean {
  return (
    position.x >= 0 &&
    position.x <= map.width &&
    position.y >= 0 &&
    position.y <= map.height
  );
}

/**
 * Check if a position is passable (can move there).
 */
export function isPositionPassable(map: CombatMap, position: Position): boolean {
  const cell = getCellAt(map, position);
  return cell?.passable ?? false;
}

/**
 * Get movement speed modifier based on terrain at position.
 */
export function getTerrainSpeedModifier(map: CombatMap, position: Position): number {
  const cell = getCellAt(map, position);
  if (!cell) return 1.0;

  switch (cell.terrain) {
    case "difficult":
    case "water":
      return 0.5;
    case "wall":
    case "obstacle":
      return 0; // Impassable
    default:
      return 1.0;
  }
}

// ── Elevation / pit terrain utilities ──────────────────────────────────

export const PIT_DEX_SAVE_DC = 15;

/**
 * Whether the terrain type is elevated ground.
 */
export function isElevatedTerrain(terrain: TerrainType): boolean {
  return terrain === "elevated";
}

/**
 * Whether the terrain type is a pit (lower ground / hole).
 */
export function isPitTerrain(terrain: TerrainType): boolean {
  return terrain === "pit";
}

/**
 * Get elevation (feet above ground level) for a map position.
 * Returns 0 when the cell does not define terrainElevation.
 */
export function getElevationOf(map: CombatMap, position: Position): number {
  const cell = getCellAt(map, position);
  if (!cell) return 0;
  return typeof cell.terrainElevation === "number" ? cell.terrainElevation : 0;
}

/**
 * Get pit depth in feet for a map position.
 * Returns 0 when the cell is not a pit or has no terrainDepth value.
 */
export function getPitDepthOf(map: CombatMap, position: Position): number {
  const cell = getCellAt(map, position);
  if (!cell || !isPitTerrain(cell.terrain)) return 0;
  return typeof cell.terrainDepth === "number" ? cell.terrainDepth : 0;
}

/**
 * Determine attack roll mode from elevation difference.
 * Returns advantage only when attacker is at least `minHeightDifferenceFeet`
 * higher than defender.
 */
export function getElevationAttackModifier(
  attackerElevationFeet: number,
  defenderElevationFeet: number,
  minHeightDifferenceFeet: number = 5,
): "advantage" | "disadvantage" | "none" {
  if (attackerElevationFeet - defenderElevationFeet >= minHeightDifferenceFeet) {
    return "advantage";
  }
  return "none";
}

/**
 * Convenience helper for checking whether the attacker has higher-ground advantage.
 */
export function hasElevationAdvantage(
  map: CombatMap,
  attackerPosition: Position | null | undefined,
  defenderPosition: Position | null | undefined,
): boolean {
  if (!attackerPosition || !defenderPosition) return false;
  const attackerElevation = getElevationOf(map, attackerPosition);
  const defenderElevation = getElevationOf(map, defenderPosition);
  const modifier = getElevationAttackModifier(attackerElevation, defenderElevation, map.gridSize);
  return modifier === "advantage";
}

/**
 * True when movement enters a pit cell from a non-pit cell.
 */
export function isPitEntry(map: CombatMap, from: Position, to: Position): boolean {
  const toCell = getCellAt(map, to);
  if (!toCell || !isPitTerrain(toCell.terrain)) return false;

  const fromCell = getCellAt(map, from);
  return !fromCell || !isPitTerrain(fromCell.terrain);
}

/**
 * Compute fall damage for pit entry.
 * D&D 5e: 1d6 per 10ft fallen, minimum 1d6.
 */
export function computePitFallDamage(depthFeet: number, diceRoller: DiceRoller): number {
  const safeDepth = Number.isFinite(depthFeet) ? Math.max(0, depthFeet) : 0;
  const diceCount = Math.max(1, Math.floor(safeDepth / 10));
  return diceRoller.rollDie(6, diceCount).total;
}
