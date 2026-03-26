import type { Ability } from "../core/ability-scores.js";

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
  readonly cannotMoveCloserToSource: boolean; // Cannot willingly move closer to fear source (Frightened)
  
  // Actions
  readonly cannotTakeActions: boolean; // Cannot take actions
  readonly cannotTakeBonusActions: boolean; // Cannot take bonus actions
  readonly cannotTakeReactions: boolean; // Cannot take reactions
  
  // Attack/Defense
  readonly attackRollsHaveAdvantage: boolean; // Attacks against have advantage
  readonly attackRollsHaveDisadvantage: boolean; // Attack rolls have disadvantage
  readonly meleeAttackAdvantage: boolean; // Melee attacks (within 5ft) against this creature have advantage (Prone)
  readonly rangedAttackDisadvantage: boolean; // Ranged attacks (beyond 5ft) against this creature have disadvantage (Prone)
  readonly selfAttackAdvantage: boolean; // This creature has advantage on its own attack rolls (Invisible)
  readonly incomingAttackDisadvantage: boolean; // Attacks against this creature have disadvantage (Invisible)
  readonly autoMissAttacks: boolean; // All attacks automatically miss
  readonly autoFailStrDexSaves: boolean; // Automatically fail Str/Dex saves
  readonly savingThrowDisadvantage: readonly Ability[]; // Disadvantage on saves for these abilities
  readonly abilityCheckDisadvantage: boolean; // Disadvantage on ability checks (Poisoned)
  
  // Damage defenses (condition-granted)
  readonly resistsAllDamage: boolean; // Resistance to all damage types (Petrified)
  readonly damageImmunities: readonly string[]; // Immune to these damage types (e.g. "poison")
  readonly conditionImmunities: readonly string[]; // Immune to these conditions/effects (e.g. "disease", "poisoned")

  // Targeting restrictions
  readonly cannotTargetSource: boolean; // Cannot attack or target the condition source with harmful effects (Charmed)
  readonly socialAdvantageForSource: boolean; // Source has advantage on social ability checks against this creature (Charmed)
  
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
    cannotMoveCloserToSource: false,
    cannotTakeActions: false,
    cannotTakeBonusActions: false,
    cannotTakeReactions: false,
    attackRollsHaveAdvantage: false,
    attackRollsHaveDisadvantage: false,
    meleeAttackAdvantage: false,
    rangedAttackDisadvantage: false,
    selfAttackAdvantage: false,
    incomingAttackDisadvantage: false,
    autoMissAttacks: false,
    autoFailStrDexSaves: false,
    savingThrowDisadvantage: [],
    abilityCheckDisadvantage: false,
    resistsAllDamage: false,
    damageImmunities: [],
    conditionImmunities: [],
    cannotTargetSource: false,
    socialAdvantageForSource: false,
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
        cannotTargetSource: true, // Can't attack or target charmer with harmful abilities/effects
        socialAdvantageForSource: true, // Charmer has advantage on Charisma checks to interact socially
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
        abilityCheckDisadvantage: true,
        cannotMoveCloserToSource: true,
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
        selfAttackAdvantage: true,
        incomingAttackDisadvantage: true,
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
        resistsAllDamage: true,
        damageImmunities: ['poison'],
        conditionImmunities: ['disease', 'poisoned'],
      };

    case 'Poisoned':
      return {
        ...baseEffects,
        attackRollsHaveDisadvantage: true,
        abilityCheckDisadvantage: true,
      };

    case 'Prone':
      return {
        ...baseEffects,
        movementImpaired: true, // Must use movement to stand
        attackRollsHaveDisadvantage: true, // Prone creature's own attacks have disadvantage
        meleeAttackAdvantage: true, // Melee attacks within 5ft against prone creature have advantage
        rangedAttackDisadvantage: true, // Ranged attacks beyond 5ft against prone creature have disadvantage
      };

    case 'Restrained':
      return {
        ...baseEffects,
        cannotMove: true,
        attackRollsHaveDisadvantage: true,
        attackRollsHaveAdvantage: true, // Attacks against
        savingThrowDisadvantage: ['dexterity'], // D&D 2024: disadvantage on DEX saves only
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
      // D&D 2024 exhaustion has levels 1-6 tracked via ActiveCondition.
      // Static effects here represent the minimum (level 1) indicators.
      // Actual penalties are computed by getExhaustionPenalty() / getExhaustionSpeedReduction()
      // based on the exhaustion level stored in the ActiveCondition.
      return {
        ...baseEffects,
        attackRollsHaveDisadvantage: false, // Replaced by d20 penalty system
        movementImpaired: true, // Speed reduced by 5 × level
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

    case 'Hidden':
      // Stealth: advantage on the creature's first attack
      return {
        ...baseEffects,
        selfAttackAdvantage: true,
      };

    case 'StunningStrikePartial':
      // 2024 partial stun: advantage on next attack against this target, speed halved
      return {
        ...baseEffects,
        attackRollsHaveAdvantage: true,
      };

    case 'Addled':
      // Open Hand Technique: disadvantage on next attack roll
      return {
        ...baseEffects,
        attackRollsHaveDisadvantage: true,
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
 * D&D 2024 Prone: Melee attacks within 5ft have advantage against prone target.
 * Ranged attacks beyond 5ft have disadvantage against prone target.
 * Returns the roll mode adjustment for attacks AGAINST a target with these conditions.
 */
export function getProneAttackModifier(
  targetConditions: readonly ActiveCondition[],
  attackerDistanceFt: number,
  attackKind: 'melee' | 'ranged',
): 'advantage' | 'disadvantage' | 'none' {
  const hasProne = targetConditions.some(c => c.condition === 'Prone');
  if (!hasProne) return 'none';

  if (attackKind === 'melee' && attackerDistanceFt <= 5) {
    return 'advantage';
  }
  if (attackKind === 'ranged' || attackerDistanceFt > 5) {
    return 'disadvantage';
  }
  return 'none';
}

/**
 * Check if any condition grants the creature advantage on its own attacks (e.g. Invisible).
 */
export function hasSelfAttackAdvantage(conditions: readonly ActiveCondition[]): boolean {
  return conditions.some(c => {
    const effects = getConditionEffects(c.condition);
    return effects.selfAttackAdvantage;
  });
}

/**
 * Check if any condition imposes disadvantage on incoming attacks against this creature (e.g. Invisible).
 */
export function hasIncomingAttackDisadvantage(conditions: readonly ActiveCondition[]): boolean {
  return conditions.some(c => {
    const effects = getConditionEffects(c.condition);
    return effects.incomingAttackDisadvantage;
  });
}

/**
 * Check if any condition imposes disadvantage on ability checks (e.g. Poisoned, Frightened).
 */
export function hasAbilityCheckDisadvantage(conditions: readonly ActiveCondition[]): boolean {
  return conditions.some(c => {
    const effects = getConditionEffects(c.condition);
    return effects.abilityCheckDisadvantage;
  });
}

/**
 * D&D 2024 Frightened: Cannot willingly move closer to fear source.
 * Returns true if the movement should be blocked because it brings the creature
 * closer to its fear source.
 * @param conditions - The creature's active conditions
 * @param currentDistanceToSource - Current distance to the fear source in feet
 * @param newDistanceToSource - Distance to the fear source after the proposed move
 */
export function isFrightenedMovementBlocked(
  conditions: readonly ActiveCondition[],
  currentDistanceToSource: number,
  newDistanceToSource: number,
): boolean {
  const frightenedCondition = conditions.find(
    c => c.condition === 'Frightened' && c.source,
  );
  if (!frightenedCondition) return false;

  // Block if moving closer to fear source
  return newDistanceToSource < currentDistanceToSource;
}

/**
 * Get the fear source ID from a Frightened condition, if present.
 */
export function getFrightenedSourceId(conditions: readonly ActiveCondition[]): string | undefined {
  const frightenedCondition = conditions.find(
    c => c.condition === 'Frightened' && c.source,
  );
  return frightenedCondition?.source;
}

// ----- Charmed Targeting Restriction (D&D 2024) -----

/**
 * D&D 2024 Charmed: A charmed creature can't attack the charmer or target
 * the charmer with harmful abilities or magical effects.
 * Returns true if the attack/targeting should be blocked.
 * @param attackerConditions - The attacking creature's active conditions
 * @param targetId - The combatant ID of the intended target
 */
export function isAttackBlockedByCharm(
  attackerConditions: readonly ActiveCondition[],
  targetId: string,
): boolean {
  return attackerConditions.some(
    c => c.condition === 'Charmed' && c.source === targetId,
  );
}

/**
 * Get all source IDs (charmers) from Charmed conditions on a creature.
 * A creature can be charmed by multiple sources simultaneously.
 */
export function getCharmedSourceIds(conditions: readonly ActiveCondition[]): string[] {
  return conditions
    .filter(c => c.condition === 'Charmed' && c.source)
    .map(c => c.source!);
}

// ----- Exhaustion Level System (D&D 2024) -----

/**
 * D&D 2024 Exhaustion: Each level gives -level penalty to all d20 tests
 * (attack rolls, ability checks, saving throws).
 * @param level - Exhaustion level (1-6)
 * @returns The penalty to apply to d20 rolls (negative number)
 */
export function getExhaustionPenalty(level: number): number {
  const clamped = Math.max(0, Math.min(6, Math.floor(level)));
  return clamped === 0 ? 0 : -clamped;
}

/**
 * D&D 2024 Exhaustion: Speed reduced by 5 × level feet.
 * @param level - Exhaustion level (1-6)
 * @returns The speed reduction in feet (positive number)
 */
export function getExhaustionSpeedReduction(level: number): number {
  const clamped = Math.max(0, Math.min(6, Math.floor(level)));
  return clamped * 5;
}

/**
 * D&D 2024 Exhaustion: Level 6 is lethal.
 * @param level - Exhaustion level
 * @returns true if the creature dies from exhaustion
 */
export function isExhaustionLethal(level: number): boolean {
  return level >= 6;
}

/**
 * Get the exhaustion level from a creature's conditions.
 * Exhaustion level is stored in the `source` field of the Exhaustion ActiveCondition
 * as "exhaustion:<level>" (e.g., "exhaustion:3").
 * Returns 0 if no exhaustion condition is present.
 */
export function getExhaustionLevel(conditions: readonly ActiveCondition[]): number {
  const exhaustionCondition = conditions.find(c => c.condition === 'Exhaustion');
  if (!exhaustionCondition) return 0;

  // Parse level from source field: "exhaustion:<level>"
  if (exhaustionCondition.source?.startsWith('exhaustion:')) {
    const parsed = parseInt(exhaustionCondition.source.split(':')[1], 10);
    if (!isNaN(parsed)) return Math.max(0, Math.min(6, parsed));
  }

  // Default to level 1 if exhaustion present without level info
  return 1;
}

/**
 * Create an Exhaustion condition with the specified level.
 */
export function createExhaustionCondition(level: number): ActiveCondition {
  const clamped = Math.max(1, Math.min(6, Math.floor(level)));
  return createCondition('Exhaustion', 'until_removed', {
    source: `exhaustion:${clamped}`,
  });
}

/**
 * Get the total exhaustion penalty from a creature's conditions for d20 tests.
 */
export function getExhaustionD20Penalty(conditions: readonly ActiveCondition[]): number {
  return getExhaustionPenalty(getExhaustionLevel(conditions));
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
 * D&D 5e 2024: Unconscious auto-applies Prone (creature falls prone).
 * TODO: Unconscious should also force dropping held items once inventory supports forced drops.
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

  let result = [...conditions, newCondition];

  // D&D 5e 2024: Unconscious automatically applies Prone
  if (newCondition.condition === "Unconscious") {
    const alreadyProne = result.some((c) => c.condition === "Prone");
    if (!alreadyProne) {
      result = [...result, createCondition("Prone" as Condition, "until_removed", { source: newCondition.source })];
    }
  }

  return result;
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
