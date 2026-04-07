/**
 * Combat Effect System
 * 
 * Manages temporary effects on creatures during combat (beyond standard conditions).
 * Effects can modify stats, grant abilities, or apply other mechanical changes.
 * 
 * This is the generic, source-agnostic buff/debuff system. Spells, features, and
 * abilities declare their effects as data (ActiveEffect instances), and the combat
 * resolution points query them generically. No spell-specific code is needed.
 */

import type { Ability } from '../core/ability-scores.js';

/**
 * Types of effects that can be applied
 */
export type EffectType =
  | 'advantage'           // Advantage on specific rolls
  | 'disadvantage'        // Disadvantage on specific rolls
  | 'bonus'               // Numeric bonus to rolls/stats
  | 'penalty'             // Numeric penalty to rolls/stats
  | 'resistance'          // Resistance to damage type
  | 'vulnerability'       // Vulnerability to damage type
  | 'immunity'            // Immunity to damage type
  | 'temp_hp'             // Temporary hit points
  | 'speed_modifier'      // Speed increase/decrease
  | 'speed_multiplier'    // Multiplicative speed changes (e.g., halved speed)
  | 'ongoing_damage'      // Recurring damage at start/end of turn
  | 'retaliatory_damage'  // Damage dealt back to melee attacker
  | 'condition_immunity'  // Prevents a specific condition from being applied
  | 'recurring_temp_hp'   // Grants temp HP at start/end of turn
  | 'custom';             // Custom effect

/**
 * What the effect applies to
 */
export type EffectTarget =
  | 'attack_rolls'
  | 'melee_attack_rolls'  // Melee-only attack modifiers (e.g., Reckless Attack)
  | 'ranged_attack_rolls' // Ranged-only attack modifiers (e.g., Archery)
  | 'damage_rolls'
  | 'melee_damage_rolls'  // Melee-only damage modifiers (e.g., Rage damage bonus)
  | 'ranged_damage_rolls' // Ranged-only damage modifiers
  | 'saving_throws'
  | 'ability_checks'
  | 'armor_class'
  | 'speed'
  | 'initiative'
  | 'hit_points'
  | 'spell_save_dc'
  | 'next_attack' // Special: only affects the very next attack
  | 'next_save'   // Special: only affects the very next saving throw
  | 'custom';

/**
 * Effect duration types
 */
export type EffectDuration =
  | 'instant'                  // Applied and removed immediately
  | 'until_end_of_turn'       // Removed at end of current creature's turn
  | 'until_start_of_next_turn' // Removed at start of creature's next turn
  | 'until_end_of_next_turn'  // Removed at end of creature's next turn
  | 'rounds'                   // Specific number of rounds
  | 'concentration'            // Lasts while caster maintains concentration
  | 'until_triggered'          // Lasts until specific condition (e.g., "next attack")
  | 'permanent';               // Never expires naturally

/**
 * Dice value for effects that roll dice (Bless 1d4, ongoing damage, etc.)
 */
export interface DiceValue {
  readonly count: number;
  readonly sides: number;
}

/**
 * Save-to-end: repeat a save at start/end of turn to end the effect
 */
export interface SaveToEnd {
  readonly ability: Ability;
  readonly dc: number;
  /** Conditions to remove from the creature when the save succeeds. */
  readonly removeConditions?: readonly string[];
}

/**
 * Active effect on a creature
 */
export interface ActiveEffect {
  readonly id: string;                     // Unique effect ID
  readonly type: EffectType;
  readonly target: EffectTarget;
  readonly value?: number;                 // For bonus/penalty/flat damage effects
  readonly diceValue?: DiceValue;          // For dice-based bonuses (Bless 1d4) or ongoing damage
  readonly ability?: Ability;              // For ability-specific effects (e.g., DEX saves only)
  readonly damageType?: string;            // For resistance/vulnerability/immunity/ongoing damage
  readonly duration: EffectDuration;
  readonly roundsRemaining?: number;       // For 'rounds' duration
  readonly source?: string;                // What caused the effect (spell name, feature name, etc.)
  readonly sourceCombatantId?: string;     // Who applied this effect (for concentration tracking)
  readonly description?: string;           // Human-readable description
  readonly appliedAtRound?: number;        // Combat round when applied
  readonly appliedAtTurnIndex?: number;    // Turn index when applied
  readonly targetCombatantId?: string;     // "effects on attacks against THIS creature" (Dodge, Faerie Fire)
  readonly triggerAt?: 'start_of_turn' | 'end_of_turn' | 'on_voluntary_move'; // When ongoing effects fire
  readonly saveToEnd?: SaveToEnd;          // Optional save to end the effect each round
  readonly conditionName?: string;         // For condition_immunity: which condition is blocked

  // ── Trigger resolution (for on_voluntary_move and other triggered effects) ──
  /** Save allowed when this trigger fires (e.g., STR save to avoid knockback on move) */
  readonly triggerSave?: {
    readonly ability: Ability;
    readonly dc: number;
    /** If true, save halves damage instead of negating it */
    readonly halfDamageOnSave?: boolean;
  };
  /** Conditions applied when trigger fires (e.g., Restrained, Prone) */
  readonly triggerConditions?: readonly string[];
  /** Optional precise expiry keyed to a specific combatant's turn event. */
  readonly expiresAt?: {
    readonly event: 'start_of_turn' | 'end_of_turn';
    readonly combatantId: string;
  };
}

/**
 * Result of calculating bonuses from effects, including dice that need rolling
 */
export interface EffectBonusResult {
  readonly flatBonus: number;
  readonly diceRolls: readonly DiceValue[];
}

/**
 * Create a new effect
 */
export function createEffect(
  id: string,
  type: EffectType,
  target: EffectTarget,
  duration: EffectDuration,
  options?: {
    value?: number;
    diceValue?: DiceValue;
    ability?: Ability;
    damageType?: string;
    roundsRemaining?: number;
    source?: string;
    sourceCombatantId?: string;
    description?: string;
    appliedAtRound?: number;
    appliedAtTurnIndex?: number;
    targetCombatantId?: string;
    triggerAt?: 'start_of_turn' | 'end_of_turn' | 'on_voluntary_move';
    saveToEnd?: SaveToEnd;
    conditionName?: string;
    triggerSave?: { ability: Ability; dc: number; halfDamageOnSave?: boolean };
    triggerConditions?: string[];
    expiresAt?: { event: 'start_of_turn' | 'end_of_turn'; combatantId: string };
  }
): ActiveEffect {
  return {
    id,
    type,
    target,
    duration,
    value: options?.value,
    diceValue: options?.diceValue,
    ability: options?.ability,
    damageType: options?.damageType,
    roundsRemaining: options?.roundsRemaining,
    source: options?.source,
    sourceCombatantId: options?.sourceCombatantId,
    description: options?.description,
    appliedAtRound: options?.appliedAtRound,
    appliedAtTurnIndex: options?.appliedAtTurnIndex,
    targetCombatantId: options?.targetCombatantId,
    triggerAt: options?.triggerAt,
    saveToEnd: options?.saveToEnd,
    conditionName: options?.conditionName,
    triggerSave: options?.triggerSave,
    triggerConditions: options?.triggerConditions,
    expiresAt: options?.expiresAt,
  };
}

/**
 * Check if an effect should be removed at end of turn
 */
export function shouldRemoveAtEndOfTurn(
  effect: ActiveEffect,
  currentRound: number,
  currentTurnIndex: number,
  isCreatureTurn: boolean
): boolean {
  if (effect.duration === 'until_end_of_turn' && isCreatureTurn) {
    return true;
  }

  if (effect.duration === 'until_end_of_next_turn') {
    if (effect.appliedAtRound === undefined || effect.appliedAtTurnIndex === undefined) {
      return false;
    }
    // Remove if at least one full turn has passed
    const turnsPassed = (currentRound - effect.appliedAtRound) * 10 + (currentTurnIndex - effect.appliedAtTurnIndex);
    return turnsPassed >= 1 && isCreatureTurn;
  }

  if (effect.duration === 'rounds' && effect.roundsRemaining !== undefined) {
    return effect.roundsRemaining <= 0;
  }

  return false;
}

/**
 * Check if an effect should be removed at start of turn
 */
export function shouldRemoveAtStartOfTurn(
  effect: ActiveEffect,
  currentRound: number,
  currentTurnIndex: number,
  isCreatureTurn: boolean
): boolean {
  if (effect.duration === 'until_start_of_next_turn') {
    if (effect.appliedAtRound === undefined || effect.appliedAtTurnIndex === undefined) {
      // No round/turn info — conservatively remove at creature's next start-of-turn.
      // Effects are always applied during a turn, so the next start-of-turn is safe to expire.
      return isCreatureTurn;
    }
    // Remove if at least one full turn has passed
    const turnsPassed = (currentRound - effect.appliedAtRound) * 10 + (currentTurnIndex - effect.appliedAtTurnIndex);
    return turnsPassed >= 1 && isCreatureTurn;
  }

  return false;
}

/**
 * Decrement rounds remaining on an effect
 */
export function decrementRounds(effect: ActiveEffect): ActiveEffect {
  if (effect.duration === 'rounds' && effect.roundsRemaining !== undefined) {
    return {
      ...effect,
      roundsRemaining: Math.max(0, effect.roundsRemaining - 1),
    };
  }
  return effect;
}

/**
 * Calculate total flat bonus AND collect dice rolls from effects for a specific target.
 * Flat bonuses are summed directly; dice values must be rolled by the caller.
 */
export function calculateBonusFromEffects(
  effects: readonly ActiveEffect[],
  target: EffectTarget,
  ability?: Ability
): EffectBonusResult {
  const matching = effects.filter(
    e => e.target === target && (ability === undefined || e.ability === ability)
  );

  let flatBonus = 0;
  const diceRolls: DiceValue[] = [];

  for (const effect of matching) {
    if (effect.type === 'bonus') {
      flatBonus += effect.value ?? 0;
      if (effect.diceValue) {
        diceRolls.push(effect.diceValue);
      }
    }
    if (effect.type === 'penalty') {
      flatBonus -= effect.value ?? 0;
      if (effect.diceValue) {
        // Penalty dice are subtracted — caller rolls and subtracts
        diceRolls.push({ count: -(effect.diceValue.count), sides: effect.diceValue.sides });
      }
    }
  }

  return { flatBonus, diceRolls };
}

/**
 * Legacy compatibility: calculate total flat bonus only (no dice).
 * Use calculateBonusFromEffects() for full dice support.
 */
export function calculateFlatBonusFromEffects(
  effects: readonly ActiveEffect[],
  target: EffectTarget,
  ability?: Ability
): number {
  return calculateBonusFromEffects(effects, target, ability).flatBonus;
}

/**
 * Check if effects grant advantage on a specific target
 */
export function hasAdvantageFromEffects(
  effects: readonly ActiveEffect[],
  target: EffectTarget,
  ability?: Ability
): boolean {
  return effects.some(
    e => e.type === 'advantage' && e.target === target
      && (ability === undefined || e.ability === ability)
      && !e.targetCombatantId // Skip target-anchored effects (e.g., Dodge/Faerie Fire); those are checked on the target side
  );
}

/**
 * Check if effects impose disadvantage on a specific target
 */
export function hasDisadvantageFromEffects(
  effects: readonly ActiveEffect[],
  target: EffectTarget,
  ability?: Ability
): boolean {
  return effects.some(
    e => e.type === 'disadvantage' && e.target === target
      && (ability === undefined || e.ability === ability)
      && !e.targetCombatantId // Skip target-anchored effects (e.g., Dodge); those are checked on the target side
  );
}

/**
 * Check if effects grant immunity to a specific condition
 */
export function hasConditionImmunity(
  effects: readonly ActiveEffect[],
  conditionName: string
): boolean {
  return effects.some(
    e => e.type === 'condition_immunity' && e.conditionName?.toLowerCase() === conditionName.toLowerCase()
  );
}

/**
 * Get all effects of a specific type (e.g., all ongoing_damage effects)
 */
export function getEffectsByType(
  effects: readonly ActiveEffect[],
  type: EffectType
): readonly ActiveEffect[] {
  return effects.filter(e => e.type === type);
}

/**
 * Get damage defense effects (resistance/vulnerability/immunity) for a specific damage type
 */
export function getDamageDefenseEffects(
  effects: readonly ActiveEffect[],
  damageType: string
): { resistances: boolean; vulnerabilities: boolean; immunities: boolean } {
  const lower = damageType.toLowerCase();
  let resistances = false;
  let vulnerabilities = false;
  let immunities = false;

  for (const e of effects) {
    if (e.damageType?.toLowerCase() !== lower) continue;
    if (e.type === 'resistance') resistances = true;
    if (e.type === 'vulnerability') vulnerabilities = true;
    if (e.type === 'immunity') immunities = true;
  }

  return { resistances, vulnerabilities, immunities };
}

/**
 * Remove triggered effects (like "next_attack" effects that have been consumed)
 */
export function removeTriggeredEffects(
  effects: readonly ActiveEffect[],
  trigger: EffectTarget
): readonly ActiveEffect[] {
  return effects.filter(e => !(e.duration === 'until_triggered' && e.target === trigger));
}

/**
 * Remove all effects from a specific source (e.g., when concentration breaks on "Bless")
 */
export function removeEffectsBySource(
  effects: readonly ActiveEffect[],
  source: string
): readonly ActiveEffect[] {
  return effects.filter(e => e.source !== source);
}

/**
 * Remove all concentration effects from a specific caster
 */
export function removeConcentrationEffects(
  effects: readonly ActiveEffect[],
  sourceCombatantId: string
): readonly ActiveEffect[] {
  return effects.filter(
    e => !(e.duration === 'concentration' && e.sourceCombatantId === sourceCombatantId)
  );
}
