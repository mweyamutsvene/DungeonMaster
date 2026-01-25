/**
 * Combat Effect System
 * 
 * Manages temporary effects on creatures during combat (beyond standard conditions).
 * Effects can modify stats, grant abilities, or apply other mechanical changes.
 */

import type { Ability } from '../core/ability-scores.js';

/**
 * Types of effects that can be applied
 */
export type EffectType =
  | 'advantage' // Advantage on specific rolls
  | 'disadvantage' // Disadvantage on specific rolls
  | 'bonus' // Numeric bonus to rolls/stats
  | 'penalty' // Numeric penalty to rolls/stats
  | 'resistance' // Resistance to damage type
  | 'vulnerability' // Vulnerability to damage type
  | 'immunity' // Immunity to damage type
  | 'temp_hp' // Temporary hit points
  | 'speed_modifier' // Speed increase/decrease
  | 'custom'; // Custom effect

/**
 * What the effect applies to
 */
export type EffectTarget =
  | 'attack_rolls'
  | 'damage_rolls'
  | 'saving_throws'
  | 'ability_checks'
  | 'armor_class'
  | 'speed'
  | 'initiative'
  | 'hit_points'
  | 'spell_save_dc'
  | 'next_attack' // Special: only affects the very next attack
  | 'next_save' // Special: only affects the very next saving throw
  | 'custom';

/**
 * Effect duration types
 */
export type EffectDuration =
  | 'instant' // Applied and removed immediately
  | 'until_end_of_turn' // Removed at end of current creature's turn
  | 'until_start_of_next_turn' // Removed at start of creature's next turn
  | 'until_end_of_next_turn' // Removed at end of creature's next turn
  | 'rounds' // Specific number of rounds
  | 'concentration' // Lasts while caster maintains concentration
  | 'until_triggered' // Lasts until specific condition (e.g., "next attack")
  | 'permanent'; // Never expires naturally

/**
 * Active effect on a creature
 */
export interface ActiveEffect {
  readonly id: string; // Unique effect ID
  readonly type: EffectType;
  readonly target: EffectTarget;
  readonly value?: number; // For bonus/penalty effects
  readonly ability?: Ability; // For ability-specific effects
  readonly duration: EffectDuration;
  readonly roundsRemaining?: number; // For 'rounds' duration
  readonly source?: string; // What caused the effect (ability name, creature ID, etc.)
  readonly description?: string; // Human-readable description
  readonly appliedAtRound?: number; // Combat round when applied
  readonly appliedAtTurnIndex?: number; // Turn index when applied
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
    ability?: Ability;
    roundsRemaining?: number;
    source?: string;
    description?: string;
    appliedAtRound?: number;
    appliedAtTurnIndex?: number;
  }
): ActiveEffect {
  return {
    id,
    type,
    target,
    duration,
    value: options?.value,
    ability: options?.ability,
    roundsRemaining: options?.roundsRemaining,
    source: options?.source,
    description: options?.description,
    appliedAtRound: options?.appliedAtRound,
    appliedAtTurnIndex: options?.appliedAtTurnIndex,
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
      return false;
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
 * Calculate total bonus from effects for a specific target
 */
export function calculateBonusFromEffects(
  effects: readonly ActiveEffect[],
  target: EffectTarget,
  ability?: Ability
): number {
  return effects
    .filter(e => e.target === target && (ability === undefined || e.ability === ability))
    .reduce((total, effect) => {
      if (effect.type === 'bonus') {
        return total + (effect.value ?? 0);
      }
      if (effect.type === 'penalty') {
        return total - (effect.value ?? 0);
      }
      return total;
    }, 0);
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
    e => e.type === 'advantage' && e.target === target && (ability === undefined || e.ability === ability)
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
    e => e.type === 'disadvantage' && e.target === target && (ability === undefined || e.ability === ability)
  );
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
