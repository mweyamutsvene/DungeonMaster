/**
 * D&D 5e Combat Map and Arena System
 *
 * Tracks positions of creatures, objects, terrain features, and environmental elements
 * on a tactical battlefield grid.
 */

import type { Position } from "./movement.js";
import { calculateDistance, isWithinRange } from "./movement.js";
import type { CombatZone } from "../entities/combat/zones.js";
import type { GroundItem } from "../entities/items/ground-item.js";

/**
 * Terrain type affects movement and cover.
 */
export type TerrainType =
  | "normal"           // Regular ground
  | "difficult"        // Rough terrain, costs 2ft per 1ft
  | "water"            // Requires swimming
  | "lava"             // Damages creatures
  | "wall"             // Impassable, blocks line of sight
  | "obstacle"         // Impassable, provides cover
  | "cover-half"       // Provides half cover (+2 AC)
  | "cover-three-quarters"  // Provides 3/4 cover (+5 AC)
  | "cover-full"       // Total cover (can't be targeted)
  | "elevated"         // Higher ground (advantage on attacks)
  | "pit"              // Lower ground or hole
  | "hazard";          // Generic dangerous area

/**
 * Cover level for ranged attacks.
 */
export type CoverLevel = "none" | "half" | "three-quarters" | "full";

/**
 * Map cell representing a 5ft x 5ft square.
 */
export interface MapCell {
  position: Position;
  terrain: TerrainType;
  /** Whether line of sight can pass through */
  blocksLineOfSight: boolean;
  /** Whether creatures can move through */
  passable: boolean;
  /** Items or objects at this position */
  objects?: string[];
}

/**
 * Entity positioned on the map (creature or item).
 */
export interface MapEntity {
  id: string;
  type: "creature" | "item" | "object";
  position: Position;
  /** Size affects reach and space occupied */
  size?: "Tiny" | "Small" | "Medium" | "Large" | "Huge" | "Gargantuan";
  /** Faction for ally/enemy detection */
  faction?: string;
}

/**
 * Combat arena/battlefield map.
 */
export interface CombatMap {
  /** Unique identifier */
  id: string;
  /** Display name */
  name: string;
  /** Map dimensions in feet */
  width: number;
  height: number;
  /** Grid size in feet (typically 5) */
  gridSize: number;
  /** Terrain/obstacle data */
  cells: MapCell[];
  /** Entities on the map */
  entities: MapEntity[];
  /** Description for narrative */
  description?: string;
  /** Custom character mappings for ASCII rendering (optional) */
  characterMappings?: {
    terrain?: Record<string, string>;
    objects?: Record<string, string>;
  };
  /** Active combat zones (spell areas, auras, etc.) */
  zones?: CombatZone[];
  /** Items on the ground (thrown, dropped, pre-placed) */
  groundItems?: GroundItem[];
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
): CombatMap {
  const cell = getCellAt(map, position);
  if (!cell) return map;

  const updatedCells = map.cells.map(c =>
    c.position.x === cell.position.x && c.position.y === cell.position.y
      ? {
          ...c,
          terrain,
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
 * Check line of sight between two positions.
 * Simplified: checks if any blocking terrain intersects the line.
 */
export function hasLineOfSight(
  map: CombatMap,
  from: Position,
  to: Position,
): { visible: boolean; blockedBy?: Position } {
  // Check if any cells along the path block line of sight
  const distance = calculateDistance(from, to);
  const steps = Math.ceil(distance / map.gridSize);

  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const checkPos = {
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    };

    const cell = getCellAt(map, checkPos);
    if (cell?.blocksLineOfSight) {
      return { visible: false, blockedBy: cell.position };
    }
  }

  return { visible: true };
}

/**
 * Calculate cover level for a target from attacker's position.
 */
export function getCoverLevel(
  map: CombatMap,
  attackerPos: Position,
  targetPos: Position,
): CoverLevel {
  // Check cells near target for cover
  const nearbyPositions = [
    { x: targetPos.x + map.gridSize, y: targetPos.y },
    { x: targetPos.x - map.gridSize, y: targetPos.y },
    { x: targetPos.x, y: targetPos.y + map.gridSize },
    { x: targetPos.x, y: targetPos.y - map.gridSize },
  ];

  let bestCover: CoverLevel = "none";

  for (const pos of nearbyPositions) {
    const cell = getCellAt(map, pos);
    if (!cell) continue;

    // Check if this cover is between attacker and target
    const distToTarget = calculateDistance(pos, targetPos);
    const distAttackerToCover = calculateDistance(attackerPos, pos);
    const distAttackerToTarget = calculateDistance(attackerPos, targetPos);

    // Cover must be closer to target than attacker
    if (distToTarget < distAttackerToCover && distAttackerToCover < distAttackerToTarget) {
      if (cell.terrain === "cover-full") return "full";
      if (cell.terrain === "cover-three-quarters") {
        if (bestCover === "none" || bestCover === "half") {
          bestCover = "three-quarters";
        }
      }
      if (cell.terrain === "cover-half" && bestCover === "none") {
        bestCover = "half";
      }
    }
  }

  return bestCover;
}

/**
 * Convert a CoverLevel to its D&D 5e 2024 AC bonus.
 * Half cover: +2 AC, Three-quarters cover: +5 AC, Full: untargetable.
 */
export function getCoverACBonus(cover: CoverLevel): number {
  switch (cover) {
    case "half":
      return 2;
    case "three-quarters":
      return 5;
    case "full":
    case "none":
    default:
      return 0;
  }
}

/**
 * Convert a CoverLevel to its D&D 5e 2024 DEX saving throw bonus.
 * Half cover: +2, Three-quarters cover: +5.
 * Full cover returns 0 — callers handle "full = unaffected" as an early return.
 */
export function getCoverSaveBonus(cover: CoverLevel): number {
  switch (cover) {
    case "half":
      return 2;
    case "three-quarters":
      return 5;
    case "full":
    case "none":
    default:
      return 0;
  }
}

/**
 * Get all entities within a radius of a position.
 */
export function getEntitiesInRadius(
  map: CombatMap,
  center: Position,
  radius: number,
): MapEntity[] {
  return map.entities.filter(e => isWithinRange(e.position, center, radius));
}

/**
 * Get all allies and enemies relative to a creature.
 */
export function getFactionsInRange(
  map: CombatMap,
  entityId: string,
  range: number,
): { allies: MapEntity[]; enemies: MapEntity[] } {
  const entity = getEntity(map, entityId);
  if (!entity) return { allies: [], enemies: [] };

  const inRange = getEntitiesInRadius(map, entity.position, range).filter(
    e => e.id !== entityId && e.type === "creature",
  );

  const allies = inRange.filter(e => e.faction === entity.faction);
  const enemies = inRange.filter(e => e.faction !== entity.faction);

  return { allies, enemies };
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

// ──────────────────────────────────── Zone Management ────────────────────────────────────

/**
 * Get all zones on the map (convenience accessor).
 */
export function getMapZones(map: CombatMap): CombatZone[] {
  return map.zones ?? [];
}

/**
 * Add a zone to the combat map. Returns a new map with the zone added.
 */
export function addZone(map: CombatMap, zone: CombatZone): CombatMap {
  return {
    ...map,
    zones: [...(map.zones ?? []), zone],
  };
}

/**
 * Remove a zone from the combat map by its ID.
 */
export function removeZone(map: CombatMap, zoneId: string): CombatMap {
  return {
    ...map,
    zones: (map.zones ?? []).filter(z => z.id !== zoneId),
  };
}

/**
 * Update a zone in the map (spread patch over existing zone).
 */
export function updateZone(map: CombatMap, zoneId: string, patch: Partial<CombatZone>): CombatMap {
  return {
    ...map,
    zones: (map.zones ?? []).map(z => (z.id === zoneId ? { ...z, ...patch } : z)),
  };
}

/**
 * Replace the entire zones array on the map.
 */
export function setMapZones(map: CombatMap, zones: CombatZone[]): CombatMap {
  return { ...map, zones };
}

// ──────────────────────────────────── Ground Item Management ────────────────────────────────────

/**
 * Get all ground items on the map.
 */
export function getGroundItems(map: CombatMap): GroundItem[] {
  return map.groundItems ?? [];
}

/**
 * Add a ground item to the map (e.g. thrown weapon landing, dropped weapon).
 */
export function addGroundItem(map: CombatMap, item: GroundItem): CombatMap {
  return {
    ...map,
    groundItems: [...(map.groundItems ?? []), item],
  };
}

/**
 * Remove a ground item from the map by ID (e.g. when picked up).
 */
export function removeGroundItem(map: CombatMap, itemId: string): CombatMap {
  return {
    ...map,
    groundItems: (map.groundItems ?? []).filter(i => i.id !== itemId),
  };
}

/**
 * Get all ground items at an exact position (same cell).
 */
export function getGroundItemsAtPosition(map: CombatMap, position: Position): GroundItem[] {
  const gridX = Math.round(position.x / map.gridSize) * map.gridSize;
  const gridY = Math.round(position.y / map.gridSize) * map.gridSize;
  return (map.groundItems ?? []).filter(i => {
    const ix = Math.round(i.position.x / map.gridSize) * map.gridSize;
    const iy = Math.round(i.position.y / map.gridSize) * map.gridSize;
    return ix === gridX && iy === gridY;
  });
}

/**
 * Get all ground items within a given radius (in feet) of a position.
 * Default radius is 5ft (adjacent cells).
 */
export function getGroundItemsNearPosition(map: CombatMap, position: Position, radiusFeet: number = 5): GroundItem[] {
  return (map.groundItems ?? []).filter(i => calculateDistance(i.position, position) <= radiusFeet + 0.0001);
}
