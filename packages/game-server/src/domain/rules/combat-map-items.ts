/**
 * D&D 5e Combat Map Ground Item Management
 *
 * Add, remove, and query items on the ground (thrown weapons, dropped equipment,
 * pre-placed loot). All functions are pure — they return new map objects.
 * Part of the combat-map module family — see combat-map.ts for the re-export barrel.
 */

import type { Position } from "./movement.js";
import { calculateDistance } from "./movement.js";
import type { GroundItem } from "../entities/items/ground-item.js";
import type { CombatMap } from "./combat-map-types.js";

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
