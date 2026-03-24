/**
 * D&D 5e Combat Map Sight and Cover
 *
 * Line-of-sight tracing, cover level detection, cover AC/save bonuses,
 * and radius/faction queries. Pure functions — no state mutation.
 * Part of the combat-map module family — see combat-map.ts for the re-export barrel.
 */

import type { Position } from "./movement.js";
import { calculateDistance, isWithinRange } from "./movement.js";
import type { CombatMap, CoverLevel, TerrainType } from "./combat-map-types.js";
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
 * Map a terrain type to the cover level it grants when interposed between
 * an attacker and a target. Pure lookup — no positional logic.
 *
 * D&D 5e 2024 cover rules:
 *   Half cover        (+2 AC / DEX save) — low walls, furniture, obstacles
 *   Three-quarters    (+5 AC / DEX save) — portcullises, arrow slits
 *   Full cover        (cannot be targeted) — solid walls, total concealment
 */
function terrainToCoverLevel(terrain: TerrainType): CoverLevel {
  switch (terrain) {
    case "wall":
    case "cover-full":
      return "full";
    case "cover-three-quarters":
      return "three-quarters";
    case "cover-half":
    case "obstacle":
      // Impassable obstacles block at least half of a Medium creature's body.
      return "half";
    default:
      return "none";
  }
}

/**
 * Calculate cover level for a target from an attacker's position.
 *
 * Ray-marches the straight line from attackerPos to targetPos using the same
 * step count as hasLineOfSight(). Each intermediate grid cell is inspected via
 * terrainToCoverLevel(). The strongest cover found anywhere on the path is
 * returned. Cells at the attacker's and target's own positions are excluded —
 * cover must be an obstacle *between* two combatants.
 */
export function getCoverLevel(
  map: CombatMap,
  attackerPos: Position,
  targetPos: Position,
): CoverLevel {
  const distance = calculateDistance(attackerPos, targetPos);
  const steps = Math.max(Math.ceil(distance / map.gridSize), 1);

  let bestCover: "none" | "half" | "three-quarters" = "none";

  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const checkPos: Position = {
      x: attackerPos.x + (targetPos.x - attackerPos.x) * t,
      y: attackerPos.y + (targetPos.y - attackerPos.y) * t,
    };

    const cell = getCellAt(map, checkPos);
    if (!cell) continue;

    const cellCover = terrainToCoverLevel(cell.terrain);
    if (cellCover === "full") return "full";
    if (cellCover === "three-quarters") bestCover = "three-quarters";
    if (cellCover === "half" && bestCover === "none") bestCover = "half";
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
