/**
 * D&D 5e Combat Map and Arena System � Barrel Re-export
 *
 * This file is the public surface for the combat-map module family.
 * All imports that reference `combat-map.js` continue to work unchanged.
 *
 * Sub-modules:
 *   combat-map-types.ts  � TerrainType, CoverLevel, MapCell, MapEntity, CombatMap
 *   combat-map-core.ts   � createCombatMap, getCellAt, setTerrainAt, entity CRUD,
 *                          isOnMap, isPositionPassable, getTerrainSpeedModifier,
 *                          getCreatureCellFootprint, computeFallDamage, computePitFallDamage
 *   combat-map-sight.ts  � hasLineOfSight, getCoverLevel, getCoverACBonus,
 *                          getCoverSaveBonus, getEntitiesInRadius, getFactionsInRange,
 *                          getObscuredLevelAt, getObscurationAttackModifiers
 *   combat-map-zones.ts  � getMapZones, addZone, removeZone, updateZone, setMapZones
 *   combat-map-items.ts  � getGroundItems, addGroundItem, removeGroundItem,
 *                          getGroundItemsAtPosition, getGroundItemsNearPosition
 */

export * from "./combat-map-types.js";
export * from "./combat-map-core.js";
export * from "./combat-map-sight.js";
export * from "./combat-map-zones.js";
export * from "./combat-map-items.js";
