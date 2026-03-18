/**
 * D&D 5e Position and Movement Mechanics
 *
 * Simplified grid-based positioning for tactical combat.
 * Uses feet as the unit (standard D&D 5e measurement).
 */

export interface Position {
  /** X coordinate in feet */
  x: number;
  /** Y coordinate in feet */
  y: number;
}

export interface MovementAttempt {
  /** Starting position */
  from: Position;
  /** Destination position */
  to: Position;
  /** Movement speed available in feet */
  speed: number;
  /** Speed modifier from conditions (e.g., difficult terrain = half speed) */
  speedModifier?: number;
  /** Whether using Dash action (doubles movement) */
  isDashing?: boolean;
}

export interface MovementResult {
  success: boolean;
  actualPosition: Position;
  distanceMoved: number;
  speedUsed: number;
  speedRemaining: number;
  reason?: string;
}

/**
 * Calculate straight-line distance between two positions (Euclidean distance).
 * D&D 5e uses various distance calculations, this is the most common.
 */
export function calculateDistance(from: Position, to: Position): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculate Manhattan distance (grid-based, sum of horizontal + vertical).
 * Alternative distance calculation for strict grid movement.
 */
export function calculateManhattanDistance(from: Position, to: Position): number {
  return Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
}

/**
 * Attempt to move from one position to another.
 */
export function attemptMovement(attempt: MovementAttempt): MovementResult {
  const distance = calculateDistance(attempt.from, attempt.to);
  const speedModifier = attempt.speedModifier ?? 1.0;
  const effectiveSpeed = attempt.isDashing
    ? attempt.speed * 2 * speedModifier
    : attempt.speed * speedModifier;

  // Check if movement is within available speed
  if (distance > effectiveSpeed) {
    return {
      success: false,
      actualPosition: attempt.from,
      distanceMoved: 0,
      speedUsed: 0,
      speedRemaining: effectiveSpeed,
      reason: `Movement distance ${Math.round(distance)}ft exceeds available speed ${Math.round(effectiveSpeed)}ft`,
    };
  }

  return {
    success: true,
    actualPosition: attempt.to,
    distanceMoved: distance,
    speedUsed: distance,
    speedRemaining: effectiveSpeed - distance,
  };
}

/**
 * Check if two positions are within a given range (in feet).
 * Used for attack range, spell range, reach checks, etc.
 */
export function isWithinRange(from: Position, to: Position, range: number): boolean {
  return calculateDistance(from, to) <= range;
}

/**
 * Check if a creature is within melee reach of another.
 * Default reach is 5ft, some weapons/creatures have 10ft+ reach.
 */
export function isWithinMeleeReach(from: Position, to: Position, reach: number = 5): boolean {
  return isWithinRange(from, to, reach);
}

/**
 * Determine if movement path crosses through another creature's reach.
 * Simplified: checks if the path passes within reach of the position.
 */
export function crossesThroughReach(
  movementPath: { from: Position; to: Position },
  blockerPosition: Position,
  reach: number = 5,
): boolean {
  // Check if either start or end is within reach
  const startInReach = isWithinRange(movementPath.from, blockerPosition, reach);
  const endInReach = isWithinRange(movementPath.to, blockerPosition, reach);

  // If you start in reach and end outside reach, you're leaving reach
  return startInReach && !endInReach;
}

/**
 * Get all positions within a radius (for area effects).
 */
export function getPositionsInRadius(center: Position, radius: number): Position[] {
  const positions: Position[] = [];
  const gridSize = 5; // 5ft squares

  // Always include the center position
  positions.push(center);

  // Simple approach: check grid squares within radius
  for (let x = center.x - radius; x <= center.x + radius; x += gridSize) {
    for (let y = center.y - radius; y <= center.y + radius; y += gridSize) {
      const pos = { x, y };
      // Skip center (already added) and check distance
      if ((pos.x !== center.x || pos.y !== center.y) && calculateDistance(center, pos) <= radius) {
        positions.push(pos);
      }
    }
  }

  return positions;
}

/**
 * Snap position to nearest 5ft grid square.
 * D&D typically uses 5ft squares.
 */
export function snapToGrid(position: Position, gridSize: number = 5): Position {
  return {
    x: Math.round(position.x / gridSize) * gridSize,
    y: Math.round(position.y / gridSize) * gridSize,
  };
}

// ——————————————————————————————————————————————
// Jump mechanics (D&D 5e 2024)
// ——————————————————————————————————————————————

/**
 * Parameters for calculating jump distance.
 */
export interface JumpParams {
  /** For Long Jump: creature's Strength score (e.g. 16). For High Jump: creature's Strength modifier (e.g. +3). */
  strengthValue: number;
  /** Whether the creature moved at least 10 feet on foot immediately before the jump. */
  hasRunningStart: boolean;
  /** Multiplier from abilities like Step of the Wind (default 1). */
  jumpDistanceMultiplier?: number;
}

/**
 * Result of a jump calculation.
 */
export interface JumpResult {
  /** Maximum distance (in feet) the creature can jump. */
  maxDistanceFeet: number;
  /** Movement cost in feet (1:1 with jump distance). */
  movementCostFeet: number;
  /** Whether a running start was used. */
  hadRunningStart: boolean;
  /** The type of jump performed. */
  jumpType: "long" | "high";
}

/**
 * Calculate Long Jump distance.
 *
 * D&D 5e 2024 Rules Glossary — Long Jump:
 * "You leap horizontally a number of feet up to your Strength score
 *  if you move at least 10 feet immediately before the jump.
 *  When you make a standing Long Jump, you can leap only half that distance.
 *  Either way, each foot you jump costs a foot of movement."
 *
 * If landing in Difficult Terrain → DC 10 Acrobatics or Prone (not enforced here; TODO).
 * Clearing a low obstacle (≤ ¼ distance) → DC 10 Athletics (DM option; TODO).
 *
 * @param strengthScore  The creature's Strength *score* (not modifier).
 * @param hasRunningStart  Whether the creature moved ≥ 10 ft on foot before the jump.
 * @param multiplier  Jump distance multiplier (e.g. 2 for Step of the Wind). Default 1.
 */
export function calculateLongJumpDistance(
  strengthScore: number,
  hasRunningStart: boolean,
  multiplier = 1,
): JumpResult {
  const base = Math.max(0, strengthScore);
  const maxDistance = hasRunningStart ? base * multiplier : Math.floor((base * multiplier) / 2);
  return {
    maxDistanceFeet: maxDistance,
    movementCostFeet: maxDistance, // each foot of jump costs a foot of movement
    hadRunningStart: hasRunningStart,
    jumpType: "long",
  };
}

/**
 * Calculate High Jump distance.
 *
 * D&D 5e 2024 Rules Glossary — High Jump:
 * "You leap into the air a number of feet equal to 3 plus your Strength modifier
 *  (minimum of 0 feet) if you move at least 10 feet on foot immediately before the jump.
 *  When you make a standing High Jump, you can jump only half that distance.
 *  Either way, each foot of the jump costs a foot of movement."
 *
 * Reach = jump height + 1.5 × creature height (not modeled here).
 *
 * @param strengthModifier  The creature's Strength *modifier* (e.g. +3).
 * @param hasRunningStart  Whether the creature moved ≥ 10 ft on foot before the jump.
 * @param multiplier  Jump distance multiplier (e.g. 2 for Step of the Wind). Default 1.
 */
export function calculateHighJumpDistance(
  strengthModifier: number,
  hasRunningStart: boolean,
  multiplier = 1,
): JumpResult {
  const base = Math.max(0, 3 + strengthModifier);
  const maxDistance = hasRunningStart ? base * multiplier : Math.floor((base * multiplier) / 2);
  return {
    maxDistanceFeet: maxDistance,
    movementCostFeet: maxDistance, // each foot of jump costs a foot of movement
    hadRunningStart: hasRunningStart,
    jumpType: "high",
  };
}

/**
 * Compute a jump landing position.
 *
 * For Long Jump: moves horizontally `distance` feet in the given direction.
 * For High Jump: lands at the same position (vertical movement, no horizontal displacement).
 *
 * If no direction is provided, defaults to positive X axis (right).
 * The result is snapped to the nearest 5ft grid boundary.
 *
 * @param origin  The creature's current position.
 * @param distance  The horizontal distance of the jump (in feet).
 * @param jumpType  "long" (horizontal) or "high" (vertical — no position change).
 * @param directionTarget  Optional target position; the jump goes in the direction from origin toward this point.
 */
export function computeJumpLandingPosition(
  origin: Position,
  distance: number,
  jumpType: "long" | "high",
  directionTarget?: Position,
): Position {
  // High jump is vertical only — creature lands at the same position
  if (jumpType === "high" || distance <= 0) {
    return { x: origin.x, y: origin.y };
  }

  // Determine direction vector
  let dx: number;
  let dy: number;

  if (directionTarget) {
    dx = directionTarget.x - origin.x;
    dy = directionTarget.y - origin.y;
  } else {
    // Default: positive X axis
    dx = 1;
    dy = 0;
  }

  const magnitude = Math.sqrt(dx * dx + dy * dy);
  if (magnitude === 0) {
    // Origin and target are the same — default to positive X
    dx = 1;
    dy = 0;
  } else {
    dx /= magnitude;
    dy /= magnitude;
  }

  // Move `distance` feet in the direction, then snap to nearest 5ft grid
  const rawX = origin.x + dx * distance;
  const rawY = origin.y + dy * distance;

  return snapToGrid({ x: rawX, y: rawY });
}

/**
 * Common movement speed modifiers.
 */
export const MOVEMENT_MODIFIERS = {
  NORMAL: 1.0,
  DIFFICULT_TERRAIN: 0.5,      // Costs 2ft per 1ft moved
  PRONE: 0.5,                  // Half speed when crawling
  CLIMBING: 0.5,               // Climbing costs 2ft per 1ft
  SWIMMING: 0.5,               // Swimming costs 2ft per 1ft
  GRAPPLED: 0,                 // Speed is 0
  RESTRAINED: 0,               // Speed is 0
  PARALYZED: 0,                // Can't move
  INCAPACITATED: 0,            // Can't move
} as const;

/**
 * Standard creature movement speeds (in feet).
 */
export const STANDARD_SPEEDS = {
  SLOW: 20,      // Small creatures, heavily armored
  NORMAL: 30,    // Most Medium creatures
  FAST: 40,      // Mobile creatures, monks
  VERY_FAST: 50, // Tabaxi, some monsters
  FLY: 60,       // Flying speed
} as const;
