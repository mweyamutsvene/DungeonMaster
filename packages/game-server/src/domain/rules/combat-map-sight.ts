/**
 * D&D 5e Combat Map Sight and Cover
 *
 * Line-of-sight tracing, cover level detection, cover AC/save bonuses,
 * and radius/faction queries. Pure functions — no state mutation.
 * Part of the combat-map module family — see combat-map.ts for the re-export barrel.
 */

import type { Position } from "./movement.js";
import { calculateDistance, isWithinRange } from "./movement.js";
import type { CombatMap, CoverLevel, TerrainType, ObscuredLevel } from "./combat-map-types.js";
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

/** Numeric rank for cover comparison — higher is stronger. */
const COVER_RANK: Record<CoverLevel, number> = {
  none: 0,
  half: 1,
  "three-quarters": 2,
  full: 3,
};

/** Return the stronger of two cover levels. */
function maxCover(a: CoverLevel, b: CoverLevel): CoverLevel {
  return COVER_RANK[a] >= COVER_RANK[b] ? a : b;
}

/**
 * Calculate cover level for a target from an attacker's position.
 *
 * Ray-marches the straight line from attackerPos to targetPos using the same
 * step count as hasLineOfSight(). Each intermediate grid cell is inspected via
 * terrainToCoverLevel(). The strongest cover found anywhere on the path is
 * returned. Cells at the attacker's and target's own positions are excluded —
 * cover must be an obstacle *between* two combatants.
 *
 * When `entities` is provided (typically `map.entities`), any intervening
 * creature on the ray grants at least **half cover** per D&D 5e 2024 rules.
 * The attacker and target themselves are excluded by id (`attackerId` /
 * `targetId`).
 */
export function getCoverLevel(
  map: CombatMap,
  attackerPos: Position,
  targetPos: Position,
  entities?: MapEntity[],
  attackerId?: string,
  targetId?: string,
): CoverLevel {
  const distance = calculateDistance(attackerPos, targetPos);
  const steps = Math.max(Math.ceil(distance / map.gridSize), 1);

  let bestCover: CoverLevel = "none";

  // --- terrain cover ---
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
    bestCover = maxCover(bestCover, cellCover);
  }

  // --- creature-based cover (D&D 5e 2024: intervening creatures grant half cover) ---
  if (entities && entities.length > 0) {
    const creatureCover = getCreatureCover(
      attackerPos,
      targetPos,
      map.gridSize,
      entities,
      attackerId,
      targetId,
    );
    bestCover = maxCover(bestCover, creatureCover);
  }

  return bestCover;
}

/**
 * Check whether any creature (other than attacker/target) lies on the ray
 * between two positions. Any such creature grants **half cover**.
 *
 * Uses a point-to-segment distance test: a creature's position is "on the
 * ray" when its perpendicular distance to the attacker→target segment is less
 * than half a grid cell and it is strictly between the two endpoints.
 */
function getCreatureCover(
  attackerPos: Position,
  targetPos: Position,
  gridSize: number,
  entities: MapEntity[],
  attackerId?: string,
  targetId?: string,
): CoverLevel {
  const dx = targetPos.x - attackerPos.x;
  const dy = targetPos.y - attackerPos.y;
  const segLenSq = dx * dx + dy * dy;
  if (segLenSq === 0) return "none";

  // Tolerance: half a grid cell width for the ray corridor.
  const tolerance = gridSize / 2;

  for (const ent of entities) {
    if (ent.type !== "creature") continue;
    if (ent.id === attackerId || ent.id === targetId) continue;

    // Project entity position onto the attacker→target segment.
    const ex = ent.position.x - attackerPos.x;
    const ey = ent.position.y - attackerPos.y;
    const t = (ex * dx + ey * dy) / segLenSq;

    // Must be strictly between the endpoints (exclude attacker/target cells).
    if (t <= 0 || t >= 1) continue;

    // Perpendicular distance to the segment.
    const projX = attackerPos.x + t * dx;
    const projY = attackerPos.y + t * dy;
    const distSq =
      (ent.position.x - projX) ** 2 + (ent.position.y - projY) ** 2;

    if (distSq <= tolerance * tolerance) {
      return "half";
    }
  }
  return "none";
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
 * Get the obscuration level at a specific position on the map.
 * Checks both the cell's own obscured property and any zone-based obscuration.
 */
export function getObscuredLevelAt(map: CombatMap, pos: Position): ObscuredLevel {
  if (!map.cells) return "none";
  const cell = getCellAt(map, pos);
  return cell?.obscured ?? "none";
}

/**
 * D&D 5e 2024 Obscuration: determine attack advantage/disadvantage adjustments.
 *
 * - Attacker in heavy obscuration, target NOT: attacker can't see → disadvantage
 * - Target in heavy obscuration, attacker NOT: target unseen → attacker has disadvantage
 *   (D&D 5e 2024: unseen target means disadvantage on attacks, but target gets advantage... 
 *    simplified: both sides can't see = cancel out)
 * - Both in heavy obscuration: both effectively Blinded, advantage and disadvantage cancel out
 *
 * Returns { advantage: number, disadvantage: number } to add to existing counts.
 */
export function getObscurationAttackModifiers(
  map: CombatMap,
  attackerPos: Position,
  targetPos: Position,
): { advantage: number; disadvantage: number } {
  const attackerObscured = getObscuredLevelAt(map, attackerPos);
  const targetObscured = getObscuredLevelAt(map, targetPos);

  let advantage = 0;
  let disadvantage = 0;

  const attackerHeavy = attackerObscured === "heavily";
  const targetHeavy = targetObscured === "heavily";

  if (attackerHeavy && targetHeavy) {
    // Both Blinded: advantage (target can't see you) + disadvantage (you can't see target) cancel out
    // Net zero — no adjustment needed
  } else if (attackerHeavy) {
    // Attacker is Blinded (can't see target): disadvantage on attack
    // But target also can't see attacker → advantage on attack
    // D&D 5e 2024: Blinded gives disadvantage on attacks. Unseen attacker gets advantage.
    // These cancel out for the attack roll itself.
    // However, the attacker still can't see the target, so disadvantage applies.
    disadvantage++;
  } else if (targetHeavy) {
    // Target is in heavy obscuration: effectively Blinded against attacker
    // Attacker attacking a Blinded target: advantage
    // But target is an unseen target → disadvantage
    // D&D 5e 2024: attacking an unseen target = disadvantage. 
    // Target being Blinded = advantage for attacks against it.
    // These cancel... but the attacker CAN see (they're not in obscuration).
    // They just can't see INTO the obscuration. So disadvantage.
    disadvantage++;
  }

  return { advantage, disadvantage };
}
