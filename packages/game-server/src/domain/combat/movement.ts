/**
 * Combat Positioning and Movement System
 * 
 * Tracks creature positions and movement during combat.
 * Simplified grid-less system using distance measurements.
 */

/**
 * Position in combat space
 * Using simple distance-based positioning (not grid-based)
 */
export interface Position {
  readonly x: number; // Horizontal position in feet
  readonly y: number; // Vertical position in feet
  readonly elevation?: number; // Height above ground in feet (for flying/climbing)
}

/**
 * Movement state for a creature
 */
export interface MovementState {
  readonly position: Position;
  readonly movementUsed: number; // Feet of movement used this turn
  readonly movementAvailable: number; // Total movement available (usually speed)
  readonly jumpDistanceMultiplier: number; // Multiplier for jump distance (default 1)
  readonly difficultTerrain: boolean; // If in difficult terrain (costs 2 feet per foot)
}

/**
 * Calculate distance between two positions (Euclidean distance)
 */
export function calculateDistance(from: Position, to: Position): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = (to.elevation ?? 0) - (from.elevation ?? 0);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Calculate Manhattan distance (grid-based distance)
 */
export function calculateManhattanDistance(from: Position, to: Position): number {
  const dx = Math.abs(to.x - from.x);
  const dy = Math.abs(to.y - from.y);
  const dz = Math.abs((to.elevation ?? 0) - (from.elevation ?? 0));
  return dx + dy + dz;
}

/**
 * Check if a creature has enough movement remaining
 */
export function hasMovementRemaining(state: MovementState, distance: number): boolean {
  const movementCost = state.difficultTerrain ? distance * 2 : distance;
  const remaining = state.movementAvailable - state.movementUsed;
  return remaining >= movementCost;
}

/**
 * Calculate movement cost considering difficult terrain
 */
export function calculateMovementCost(distance: number, difficultTerrain: boolean): number {
  return difficultTerrain ? distance * 2 : distance;
}

/**
 * Use movement (spend feet of movement)
 */
export function useMovement(state: MovementState, distance: number): MovementState {
  const cost = calculateMovementCost(distance, state.difficultTerrain);
  return {
    ...state,
    movementUsed: Math.min(state.movementAvailable, state.movementUsed + cost),
  };
}

/**
 * Move a creature to a new position
 */
export function moveToPosition(
  state: MovementState,
  newPosition: Position
): { success: boolean; newState: MovementState; distanceMoved: number } {
  const distance = calculateDistance(state.position, newPosition);
  
  if (!hasMovementRemaining(state, distance)) {
    return {
      success: false,
      newState: state,
      distanceMoved: 0,
    };
  }

  const newState = useMovement({ ...state, position: newPosition }, distance);
  
  return {
    success: true,
    newState,
    distanceMoved: distance,
  };
}

/**
 * Move in a direction by a specific distance
 */
export function moveInDirection(
  state: MovementState,
  direction: 'forward' | 'backward' | 'left' | 'right' | 'up' | 'down',
  distance: number
): { success: boolean; newState: MovementState } {
  if (!hasMovementRemaining(state, distance)) {
    return {
      success: false,
      newState: state,
    };
  }

  let newPosition: Position;
  const currentElevation = state.position.elevation ?? 0;

  switch (direction) {
    case 'forward':
      newPosition = { ...state.position, y: state.position.y + distance };
      break;
    case 'backward':
      newPosition = { ...state.position, y: state.position.y - distance };
      break;
    case 'left':
      newPosition = { ...state.position, x: state.position.x - distance };
      break;
    case 'right':
      newPosition = { ...state.position, x: state.position.x + distance };
      break;
    case 'up':
      newPosition = { ...state.position, elevation: currentElevation + distance };
      break;
    case 'down':
      newPosition = { ...state.position, elevation: Math.max(0, currentElevation - distance) };
      break;
  }

  const newState = useMovement({ ...state, position: newPosition }, distance);

  return {
    success: true,
    newState,
  };
}

/**
 * Snap a position to the nearest 5ft grid point.
 */
export function snapToGrid(position: Position): Position {
  return {
    x: Math.round(position.x / 5) * 5,
    y: Math.round(position.y / 5) * 5,
    elevation: position.elevation,
  };
}

/**
 * Push a creature away from a source position
 */
export function pushAwayFrom(
  state: MovementState,
  sourcePosition: Position,
  distance: number
): MovementState {
  // Calculate direction away from source
  const dx = state.position.x - sourcePosition.x;
  const dy = state.position.y - sourcePosition.y;
  
  // Normalize direction
  const magnitude = Math.sqrt(dx * dx + dy * dy);
  if (magnitude === 0) {
    // If at same position, push in arbitrary direction
    return {
      ...state,
      position: snapToGrid({ ...state.position, x: state.position.x + distance }),
    };
  }

  const normalizedDx = dx / magnitude;
  const normalizedDy = dy / magnitude;

  // Calculate new position and snap to 5ft grid
  const rawPosition: Position = {
    x: state.position.x + normalizedDx * distance,
    y: state.position.y + normalizedDy * distance,
    elevation: state.position.elevation,
  };

  return {
    ...state,
    position: snapToGrid(rawPosition),
  };
}

/**
 * Pull a creature toward a source position
 */
export function pullToward(
  state: MovementState,
  sourcePosition: Position,
  distance: number
): MovementState {
  // Calculate direction toward source
  const dx = sourcePosition.x - state.position.x;
  const dy = sourcePosition.y - state.position.y;
  
  // Normalize direction
  const magnitude = Math.sqrt(dx * dx + dy * dy);
  if (magnitude === 0) {
    return state; // Already at source position
  }

  // Don't move past the source
  const actualDistance = Math.min(distance, magnitude);
  const normalizedDx = dx / magnitude;
  const normalizedDy = dy / magnitude;

  // Calculate new position and snap to 5ft grid
  const rawPosition: Position = {
    x: state.position.x + normalizedDx * actualDistance,
    y: state.position.y + normalizedDy * actualDistance,
    elevation: state.position.elevation,
  };

  return {
    ...state,
    position: snapToGrid(rawPosition),
  };
}

/**
 * Reset movement for a new turn
 */
export function resetMovement(state: MovementState, newSpeed?: number): MovementState {
  return {
    ...state,
    movementUsed: 0,
    movementAvailable: newSpeed ?? state.movementAvailable,
    jumpDistanceMultiplier: 1, // Reset jump multiplier
  };
}

/**
 * Apply jump distance multiplier (e.g., Step of the Wind doubles jump distance)
 */
export function setJumpMultiplier(state: MovementState, multiplier: number): MovementState {
  return {
    ...state,
    jumpDistanceMultiplier: multiplier,
  };
}

/**
 * Create initial movement state
 */
export function createMovementState(
  position: Position,
  speed: number
): MovementState {
  return {
    position,
    movementUsed: 0,
    movementAvailable: speed,
    jumpDistanceMultiplier: 1,
    difficultTerrain: false,
  };
}
