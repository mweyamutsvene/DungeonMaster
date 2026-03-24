/**
 * D&D 5e Combat Map Sight and Cover
 *
 * Line-of-sight tracing, cover level detection, cover AC/save bonuses,
 * and radius/faction queries. Pure functions — no state mutation.
 * Part of the combat-map module family — see combat-map.ts for the re-export barrel.
 */

import type { Position } from "./movement.js";
import { calculateDistance, isWithinRange } from "./movement.js";
import type { CombatMap, CoverLevel } from "./combat-map-types.js";
import { getCellAt, getEntity } from "./combat-map-core.js";
import type { MapEntity } from "./combat-map-types.js";

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
