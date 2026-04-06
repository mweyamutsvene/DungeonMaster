/**
 * D&D 5e 2024 Flanking (Optional Rule)
 *
 * When two allies are on opposite sides of an enemy (a straight line from
 * one creature's space center through the enemy's space center to the other
 * creature's space center), they gain advantage on melee attack rolls against
 * that enemy. Only applies to melee attacks. Both flanking creatures must be
 * within 5 feet of the target.
 *
 * This is an encounter-level opt-in rule (flankingEnabled on encounter options).
 */

import type { Position } from "./movement.js";

/**
 * Check whether the attacker and a single ally are in a flanking position
 * around the target on a standard grid.
 *
 * For Medium creatures on a 5ft grid, "opposite sides or opposite corners" means
 * the target's center is the midpoint of the line between attacker and ally,
 * AND both are adjacent (within one grid step via Chebyshev distance).
 *
 * @param attacker - Position of the attacking creature
 * @param target   - Position of the flanked creature
 * @param ally     - Position of the ally creature
 * @param gridSize - Grid cell size in feet (default 5)
 */
export function isFlanking(
  attacker: Position,
  target: Position,
  ally: Position,
  gridSize: number = 5,
): boolean {
  // Both attacker and ally must be adjacent to target (Chebyshev distance ≤ gridSize)
  if (!isAdjacent(attacker, target, gridSize)) return false;
  if (!isAdjacent(ally, target, gridSize)) return false;

  // Attacker and ally cannot be on the same cell
  if (attacker.x === ally.x && attacker.y === ally.y) return false;

  // Check "opposite sides or corners": target must be the midpoint of attacker–ally line.
  // Using integer arithmetic to avoid floating-point: (ax + alx) === 2*tx
  return (
    attacker.x + ally.x === 2 * target.x &&
    attacker.y + ally.y === 2 * target.y
  );
}

/**
 * Check whether ANY ally creates a flanking pair with the attacker against the target.
 *
 * @param attackerPos     - Position of the attacking creature
 * @param targetPos       - Position of the target creature
 * @param alliedPositions - Positions of all allies (excluding the attacker)
 * @param gridSize        - Grid cell size in feet (default 5)
 */
export function checkFlanking(
  attackerPos: Position,
  targetPos: Position,
  alliedPositions: readonly Position[],
  gridSize: number = 5,
): boolean {
  return alliedPositions.some((allyPos) =>
    isFlanking(attackerPos, targetPos, allyPos, gridSize),
  );
}

/**
 * Two positions are adjacent if the Chebyshev distance (max of |dx|, |dy|)
 * equals exactly one grid step. A creature at distance 0 (same cell) is NOT adjacent.
 */
function isAdjacent(a: Position, b: Position, gridSize: number): boolean {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  const chebyshev = Math.max(dx, dy);
  return chebyshev > 0 && chebyshev <= gridSize;
}
