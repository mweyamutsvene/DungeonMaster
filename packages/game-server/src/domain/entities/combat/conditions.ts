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
  // Standard D&D 5e conditions
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
  | 'Unconscious'
  // Game-specific conditions
  | 'Hidden'               // Stealth: grants advantage on first attack
  | 'Addled'               // Open Hand Technique: disadvantage on next attack
  | 'StunningStrikePartial' // 2024 partial stun: advantage on next attack vs target, speed halved
  // Weapon Mastery conditions
  | 'Sapped'               // Sap mastery: disadvantage on next attack roll before your next turn
  | 'Slowed';              // Slow mastery: speed reduced by 10ft until start of attacker's next turn

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
  /** When and whose turn triggers automatic expiry */
  readonly expiresAt?: {
    event: 'start_of_turn' | 'end_of_turn';
    combatantId: string; // Whose turn triggers expiry
  };
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

    case 'Sapped':
      // Sap mastery: disadvantage on next attack roll
      return {
        ...baseEffects,
        attackRollsHaveDisadvantage: true,
      };

    case 'Slowed':
      // Slow mastery: speed reduced by 10ft
      return {
        ...baseEffects,
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
    expiresAt?: { event: 'start_of_turn' | 'end_of_turn'; combatantId: string };
  }
): ActiveCondition {
  return {
    condition,
    duration,
    roundsRemaining: options?.roundsRemaining,
    source: options?.source,
    appliedAtRound: options?.appliedAtRound,
    appliedAtTurnIndex: options?.appliedAtTurnIndex,
    expiresAt: options?.expiresAt,
  };
}

// ----- Structured condition management helpers -----

/**
 * Check whether a conditions value is an ActiveCondition[] (structured)
 * or a legacy string[].
 */
export function isActiveConditionArray(conditions: unknown): conditions is ActiveCondition[] {
  if (!Array.isArray(conditions) || conditions.length === 0) return false;
  const first = conditions[0];
  return typeof first === "object" && first !== null && "condition" in first && "duration" in first;
}

/**
 * Normalize a conditions value (which may be string[] or ActiveCondition[])
 * into an ActiveCondition[]. Legacy string entries become `until_removed`.
 */
export function normalizeConditions(conditions: unknown): ActiveCondition[] {
  if (!Array.isArray(conditions)) return [];
  if (conditions.length === 0) return [];

  if (isActiveConditionArray(conditions)) {
    return conditions;
  }

  // Legacy string[] format
  return (conditions as string[])
    .filter((c): c is string => typeof c === "string")
    .map((name) => createCondition(name as Condition, "until_removed"));
}

/**
 * Convert an ActiveCondition[] back to a flat string[] for backward compatibility
 * with code that reads conditions as string[].
 */
export function conditionsToStringArray(conditions: readonly ActiveCondition[]): string[] {
  return conditions.map((c) => c.condition);
}

/**
 * Read condition names as string[] from a raw conditions value (DB column).
 * Handles both legacy string[] format and structured ActiveCondition[] format.
 * Use this for condition name checks (advantage/disadvantage, incapacitated, etc.)
 */
export function readConditionNames(conditions: unknown): string[] {
  return conditionsToStringArray(normalizeConditions(conditions));
}

/**
 * Check if a specific condition is present in an ActiveCondition[].
 */
export function hasCondition(conditions: readonly ActiveCondition[], conditionName: Condition): boolean {
  return conditions.some((c) => c.condition === conditionName);
}

/**
 * Add a condition to the list (does not duplicate if already present from the same source).
 * Returns a new array.
 */
export function addCondition(
  conditions: readonly ActiveCondition[],
  newCondition: ActiveCondition,
): ActiveCondition[] {
  // Check for duplicate from same source
  const exists = conditions.some(
    (c) => c.condition === newCondition.condition && c.source === newCondition.source,
  );
  if (exists) return [...conditions];
  return [...conditions, newCondition];
}

/**
 * Remove all instances of a specific condition. Returns a new array.
 */
export function removeCondition(
  conditions: readonly ActiveCondition[],
  conditionName: Condition,
): ActiveCondition[] {
  return conditions.filter((c) => c.condition !== conditionName);
}

/**
 * Remove expired conditions based on turn event.
 * Returns a tuple of [remaining conditions, removed condition names].
 */
export function removeExpiredConditions(
  conditions: readonly ActiveCondition[],
  event: 'start_of_turn' | 'end_of_turn',
  combatantId: string,
): { remaining: ActiveCondition[]; removed: Condition[] } {
  const remaining: ActiveCondition[] = [];
  const removed: Condition[] = [];

  for (const c of conditions) {
    let expired = false;

    // Check expiresAt-based expiry
    if (c.expiresAt && c.expiresAt.event === event && c.expiresAt.combatantId === combatantId) {
      expired = true;
    }

    // Check duration-based expiry (only for conditions without explicit expiresAt targeting)
    // When expiresAt is defined, it provides specific combatant-targeted expiry and takes
    // precedence over generic duration-based expiry. This prevents conditions like Stunned
    // (which should expire at start of the MONK's next turn) from being removed at the
    // start of ANY creature's turn.
    if (!expired && !c.expiresAt) {
      if (event === 'end_of_turn' && c.duration === 'until_end_of_turn') {
        // Expires at end of the turn it was applied — combatantId should match the actor
        expired = true;
      }
      if (event === 'start_of_turn' && c.duration === 'until_start_of_next_turn') {
        expired = true;
      }
      if (event === 'end_of_turn' && c.duration === 'until_end_of_next_turn') {
        expired = true;
      }
    }

    if (expired) {
      removed.push(c.condition);
    } else {
      remaining.push(c);
    }
  }

  return { remaining, removed };
}
