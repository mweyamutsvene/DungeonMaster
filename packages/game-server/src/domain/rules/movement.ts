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
