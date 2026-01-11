/**
 * D&D 5e Search and Use Object Actions
 */

import type { DiceRoller } from "./dice-roller.js";
import { abilityCheck } from "./ability-checks.js";
import type { RollMode } from "./advantage.js";

/**
 * Search Action - Wisdom (Perception) or Intelligence (Investigation)
 */
export interface SearchAttempt {
  /** Perception or Investigation modifier */
  modifier: number;
  /** DC to find the hidden thing */
  dc: number;
  /** Roll mode */
  mode?: RollMode;
  /** Type of check: visual (Perception) or logical (Investigation) */
  checkType: "perception" | "investigation";
}

export interface SearchResult {
  success: boolean;
  roll: number;
  dc: number;
}

/**
 * Make a Search check (Perception or Investigation).
 */
export function attemptSearch(
  diceRoller: DiceRoller,
  attempt: SearchAttempt,
): SearchResult {
  const check = abilityCheck(diceRoller, {
    dc: attempt.dc,
    abilityModifier: attempt.modifier,
    mode: attempt.mode ?? "normal",
  });

  return {
    success: check.success,
    roll: check.total,
    dc: attempt.dc,
  };
}

/**
 * Use an Object Action
 * Represents interacting with an object during combat.
 * Most object interactions are free, but some require an action.
 */
export type ObjectUseType =
  | "drink-potion"        // Drink a potion (heals or grants effect)
  | "open-door"           // Open/close a door
  | "pull-lever"          // Activate a mechanism
  | "retrieve-item"       // Get item from backpack (usually free, action if buried deep)
  | "light-torch"         // Light a torch or lantern
  | "throw-object"        // Throw a non-weapon object
  | "use-magic-item"      // Activate a magic item
  | "read-scroll"         // Read a spell scroll
  | "custom";             // Other object interactions

export interface UseObjectAttempt {
  objectType: ObjectUseType;
  /** Some uses might require a check (e.g., breaking down a door) */
  requiresCheck?: {
    dc: number;
    modifier: number;
    checkType: "strength" | "dexterity" | "intelligence" | "other";
    mode?: RollMode;
  };
}

export interface UseObjectResult {
  success: boolean;
  objectType: ObjectUseType;
  roll?: number;
  dc?: number;
  reason?: string;
}

/**
 * Use an object during combat.
 */
export function useObject(
  diceRoller: DiceRoller,
  attempt: UseObjectAttempt,
): UseObjectResult {
  // Most object uses succeed automatically
  if (!attempt.requiresCheck) {
    return {
      success: true,
      objectType: attempt.objectType,
    };
  }

  // Some require a check (e.g., breaking a door)
  const check = abilityCheck(diceRoller, {
    dc: attempt.requiresCheck.dc,
    abilityModifier: attempt.requiresCheck.modifier,
    mode: attempt.requiresCheck.mode ?? "normal",
  });

  return {
    success: check.success,
    objectType: attempt.objectType,
    roll: check.total,
    dc: attempt.requiresCheck.dc,
  };
}
