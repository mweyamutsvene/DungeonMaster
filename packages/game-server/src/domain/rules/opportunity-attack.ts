/**
 * D&D 5e Opportunity Attack Mechanics
 *
 * Rules:
 * - When a creature moves out of your reach, you can use your reaction to make one melee attack
 * - You can only take one reaction per round (resets at start of your turn)
 * - The Disengage action prevents opportunity attacks
 * - Moving within reach doesn't provoke (only leaving reach)
 * - You must be able to see the creature
 * - You can't use a reaction if incapacitated
 */

export interface ReactionState {
  /** Whether reaction has been used this round */
  reactionUsed: boolean;
}

export interface OpportunityAttackTrigger {
  /** The creature that is moving (potential target) */
  movingCreatureId: string;
  /** The creature that might get an opportunity attack (observer) */
  observerId: string;
  /** Whether the moving creature took the Disengage action */
  disengaged: boolean;
  /** Whether the observer can see the moving creature */
  canSee: boolean;
  /** Whether the observer is incapacitated */
  observerIncapacitated: boolean;
  /** Whether the moving creature is leaving the observer's reach */
  leavingReach: boolean;
  /** Whether the observer is charmed by the moving creature (cannot attack charmer) */
  observerCharmedByTarget?: boolean;
  /** Whether the movement is involuntary (teleportation, push, pull, carried) — does not provoke OAs */
  involuntaryMovement?: boolean;
  /** Whether the observer has War Caster feat — can cast a spell instead of weapon OA */
  warCasterEnabled?: boolean;
}

export interface OpportunityAttackResult {
  /** Whether an opportunity attack can be made */
  canAttack: boolean;
  /** Reason if can't attack */
  reason?: 'no-reaction' | 'disengaged' | 'cannot-see' | 'incapacitated' | 'not-leaving-reach' | 'charmed-by-target' | 'involuntary-movement';
  /** Whether the observer can use a spell instead of a weapon attack for this OA (War Caster) */
  canCastSpellAsOA?: boolean;
}

/**
 * Check if an opportunity attack can be made.
 */
export function canMakeOpportunityAttack(
  reactionState: ReactionState,
  trigger: OpportunityAttackTrigger,
): OpportunityAttackResult {
  // Must not have already used reaction
  if (reactionState.reactionUsed) {
    return { canAttack: false, reason: 'no-reaction' };
  }

  // Creature must be leaving reach
  if (!trigger.leavingReach) {
    return { canAttack: false, reason: 'not-leaving-reach' };
  }

  // Involuntary movement (teleportation, push, pull, carried) doesn't provoke
  if (trigger.involuntaryMovement) {
    return { canAttack: false, reason: 'involuntary-movement' };
  }

  // Can't attack if moving creature disengaged
  if (trigger.disengaged) {
    return { canAttack: false, reason: 'disengaged' };
  }

  // Must be able to see the target
  if (!trigger.canSee) {
    return { canAttack: false, reason: 'cannot-see' };
  }

  // Can't use reaction if incapacitated
  if (trigger.observerIncapacitated) {
    return { canAttack: false, reason: 'incapacitated' };
  }

  // Can't attack the charmer (Charmed condition)
  if (trigger.observerCharmedByTarget) {
    return { canAttack: false, reason: 'charmed-by-target' };
  }

  return {
    canAttack: true,
    canCastSpellAsOA: trigger.warCasterEnabled === true ? true : undefined,
  };
}

/**
 * Mark reaction as used.
 */
export function useReaction(state: ReactionState): ReactionState {
  return { reactionUsed: true };
}

/**
 * Reset reaction at start of turn.
 */
export function resetReaction(): ReactionState {
  return { reactionUsed: false };
}

/**
 * Create initial reaction state.
 */
export function createReactionState(): ReactionState {
  return { reactionUsed: false };
}

/**
 * Check if a creature has their reaction available.
 */
export function hasReactionAvailable(state: ReactionState): boolean {
  return !state.reactionUsed;
}

/**
 * Check if a creature is within melee reach of another (simplified 5ft grid).
 * In a full implementation, this would account for creature size and weapon reach.
 */
export function isWithinReach(distance: number, reach: number = 5): boolean {
  return distance <= reach;
}

/**
 * Determine if movement from one position to another leaves reach.
 * Simplified: if starting within reach and ending outside reach.
 */
export function isLeavingReach(
  startDistance: number,
  endDistance: number,
  reach: number = 5,
): boolean {
  return isWithinReach(startDistance, reach) && !isWithinReach(endDistance, reach);
}
