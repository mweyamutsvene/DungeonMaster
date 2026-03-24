/**
 * D&D 5e Combat Map Zone Management
 *
 * Add, remove, update, and query active combat zones (spell areas, auras, etc.)
 * on the combat map. All functions are pure — they return new map objects.
 * Part of the combat-map module family — see combat-map.ts for the re-export barrel.
 */

import type { CombatZone } from "../entities/combat/zones.js";
import type { CombatMap } from "./combat-map-types.js";

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
