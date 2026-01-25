/**
 * D&D 5e Conditions System
 * 
 * Implements standard conditions as defined in D&D 5e rules.
 * Conditions affect creature capabilities and are typically removed at specific times.
 */

/**
 * Standard D&D 5e conditions
 */
export type Condition =
  | 'Blinded'
  | 'Charmed'
  | 'Deafened'
  | 'Exhaustion'
  | 'Frightened'
  | 'Grappled'
  | 'Incapacitated'
  | 'Invisible'
  | 'Paralyzed'
  | 'Petrified'
  | 'Poisoned'
  | 'Prone'
  | 'Restrained'
  | 'Stunned'
  | 'Unconscious';

/**
 * Condition duration types
 */
export type ConditionDuration =
  | 'instant' // Removed immediately after application
  | 'until_end_of_turn' // Removed at end of creature's turn
  | 'until_start_of_next_turn' // Removed at start of creature's next turn
  | 'until_end_of_next_turn' // Removed at end of creature's next turn
  | 'rounds' // Specific number of rounds
  | 'until_removed' // Must be manually removed
  | 'permanent'; // Never expires

/**
 * Active condition on a creature
 */
export interface ActiveCondition {
  readonly condition: Condition;
  readonly duration: ConditionDuration;
  readonly roundsRemaining?: number; // For 'rounds' duration
  readonly source?: string; // What caused the condition (ability name, creature ID, etc.)
  readonly appliedAtRound?: number; // Combat round when applied
  readonly appliedAtTurnIndex?: number; // Turn index when applied
}

/**
 * Condition effects on creature capabilities
 */
export interface ConditionEffects {
  // Movement
  readonly movementImpaired: boolean; // Speed reduced to 0 or disadvantage on movement
  readonly cannotMove: boolean; // Speed is 0
  
  // Actions
  readonly cannotTakeActions: boolean; // Cannot take actions
  readonly cannotTakeBonusActions: boolean; // Cannot take bonus actions
  readonly cannotTakeReactions: boolean; // Cannot take reactions
  
  // Attack/Defense
  readonly attackRollsHaveAdvantage: boolean; // Attacks against have advantage
  readonly attackRollsHaveDisadvantage: boolean; // Attack rolls have disadvantage
  readonly autoMissAttacks: boolean; // All attacks automatically miss
  readonly autoFailStrDexSaves: boolean; // Automatically fail Str/Dex saves
  
  // Other
  readonly cannotSpeak: boolean; // Cannot speak or cast spells with verbal components
  readonly cannotSee: boolean; // Blinded
  readonly cannotHear: boolean; // Deafened
}

/**
 * Get the mechanical effects of a condition
 */
export function getConditionEffects(condition: Condition): ConditionEffects {
  const baseEffects: ConditionEffects = {
    movementImpaired: false,
    cannotMove: false,
    cannotTakeActions: false,
    cannotTakeBonusActions: false,
    cannotTakeReactions: false,
    attackRollsHaveAdvantage: false,
    attackRollsHaveDisadvantage: false,
    autoMissAttacks: false,
    autoFailStrDexSaves: false,
    cannotSpeak: false,
    cannotSee: false,
    cannotHear: false,
  };

  switch (condition) {
    case 'Blinded':
      return {
        ...baseEffects,
        cannotSee: true,
        attackRollsHaveDisadvantage: true,
        attackRollsHaveAdvantage: true, // Attacks against
      };

    case 'Charmed':
      return {
        ...baseEffects,
        // Charmed: can't attack charmer, charmer has advantage on social checks
      };

    case 'Deafened':
      return {
        ...baseEffects,
        cannotHear: true,
      };

    case 'Frightened':
      return {
        ...baseEffects,
        attackRollsHaveDisadvantage: true,
        // Cannot willingly move closer to source of fear
      };

    case 'Grappled':
      return {
        ...baseEffects,
        cannotMove: true,
      };

    case 'Incapacitated':
      return {
        ...baseEffects,
        cannotTakeActions: true,
        cannotTakeBonusActions: true,
        cannotTakeReactions: true,
      };

    case 'Invisible':
      return {
        ...baseEffects,
        attackRollsHaveAdvantage: true, // Attacks against have disadvantage (inverse)
      };

    case 'Paralyzed':
      return {
        ...baseEffects,
        cannotMove: true,
        cannotTakeActions: true,
        cannotTakeBonusActions: true,
        cannotTakeReactions: true,
        cannotSpeak: true,
        autoFailStrDexSaves: true,
        attackRollsHaveAdvantage: true, // Attacks against
        // Any attack within 5 ft is crit
      };

    case 'Petrified':
      return {
        ...baseEffects,
        cannotMove: true,
        cannotTakeActions: true,
        cannotTakeBonusActions: true,
        cannotTakeReactions: true,
        cannotSpeak: true,
        attackRollsHaveAdvantage: true, // Attacks against
        autoFailStrDexSaves: true,
        // Resistance to all damage, immune to poison/disease
      };

    case 'Poisoned':
      return {
        ...baseEffects,
        attackRollsHaveDisadvantage: true,
        // Disadvantage on ability checks too
      };

    case 'Prone':
      return {
        ...baseEffects,
        movementImpaired: true, // Must use movement to stand
        attackRollsHaveDisadvantage: true,
        attackRollsHaveAdvantage: true, // Melee attacks against have advantage
        // Ranged attacks against have disadvantage
      };

    case 'Restrained':
      return {
        ...baseEffects,
        cannotMove: true,
        attackRollsHaveDisadvantage: true,
        attackRollsHaveAdvantage: true, // Attacks against
        autoFailStrDexSaves: true, // Disadvantage on Dex saves
      };

    case 'Stunned':
      return {
        ...baseEffects,
        cannotMove: true,
        cannotTakeActions: true,
        cannotTakeBonusActions: true,
        cannotTakeReactions: true,
        cannotSpeak: true,
        autoFailStrDexSaves: true,
        attackRollsHaveAdvantage: true, // Attacks against
      };

    case 'Unconscious':
      return {
        ...baseEffects,
        cannotMove: true,
        cannotTakeActions: true,
        cannotTakeBonusActions: true,
        cannotTakeReactions: true,
        cannotSpeak: true,
        cannotSee: true,
        autoMissAttacks: true,
        autoFailStrDexSaves: true,
        attackRollsHaveAdvantage: true, // Attacks against
        // Any attack within 5 ft is crit, drops items, automatically prone
      };

    case 'Exhaustion':
      // Exhaustion has levels (1-6) but we simplify to single condition
      return {
        ...baseEffects,
        attackRollsHaveDisadvantage: true,
        movementImpaired: true,
      };

    default:
      return baseEffects;
  }
}

/**
 * Check if a condition prevents taking actions
 */
export function canTakeActions(conditions: readonly ActiveCondition[]): boolean {
  return !conditions.some(c => {
    const effects = getConditionEffects(c.condition);
    return effects.cannotTakeActions;
  });
}

/**
 * Check if a condition prevents taking bonus actions
 */
export function canTakeBonusActions(conditions: readonly ActiveCondition[]): boolean {
  return !conditions.some(c => {
    const effects = getConditionEffects(c.condition);
    return effects.cannotTakeBonusActions;
  });
}

/**
 * Check if a condition prevents taking reactions
 */
export function canTakeReactions(conditions: readonly ActiveCondition[]): boolean {
  return !conditions.some(c => {
    const effects = getConditionEffects(c.condition);
    return effects.cannotTakeReactions;
  });
}

/**
 * Check if a condition prevents movement
 */
export function canMove(conditions: readonly ActiveCondition[]): boolean {
  return !conditions.some(c => {
    const effects = getConditionEffects(c.condition);
    return effects.cannotMove;
  });
}

/**
 * Determine if attacks have advantage due to conditions
 */
export function hasAttackAdvantage(conditions: readonly ActiveCondition[]): boolean {
  return conditions.some(c => {
    const effects = getConditionEffects(c.condition);
    return effects.attackRollsHaveAdvantage;
  });
}

/**
 * Determine if attacks have disadvantage due to conditions
 */
export function hasAttackDisadvantage(conditions: readonly ActiveCondition[]): boolean {
  return conditions.some(c => {
    const effects = getConditionEffects(c.condition);
    return effects.attackRollsHaveDisadvantage;
  });
}

/**
 * Create a new active condition
 */
export function createCondition(
  condition: Condition,
  duration: ConditionDuration,
  options?: {
    roundsRemaining?: number;
    source?: string;
    appliedAtRound?: number;
    appliedAtTurnIndex?: number;
  }
): ActiveCondition {
  return {
    condition,
    duration,
    roundsRemaining: options?.roundsRemaining,
    source: options?.source,
    appliedAtRound: options?.appliedAtRound,
    appliedAtTurnIndex: options?.appliedAtTurnIndex,
  };
}
