export { resolveAttack, isAutoCriticalHit, type DamageSpec, type AttackSpec, type AttackRoll, type AttackResult, type AttackResolveOptions } from "./attack-resolver.js";
export { Combat, type Combatant, type CombatState } from "./combat.js";
export { rollInitiative, swapInitiative, type InitiativeEntry } from "./initiative.js";
export { calculateDistance, calculateManhattanDistance, hasMovementRemaining, calculateMovementCost, useMovement, moveToPosition, moveInDirection, snapToGrid, pushAwayFrom, pullToward, resetMovement, setJumpMultiplier, createMovementState, type Position, type MovementState } from "./movement.js";
