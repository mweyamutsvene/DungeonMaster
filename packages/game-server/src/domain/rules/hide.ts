/**
 * D&D 5e Hide Action Mechanics
 *
 * Rules:
 * - Make a Dexterity (Stealth) check
 * - Must have something to hide behind (cover or obscurement)
 * - Can't hide from a creature that can see you clearly
 * - Contested by Wisdom (Perception) passive or active checks
 * - Breaking stealth: attacking, casting most spells, making noise
 */

import type { DiceRoller } from "./dice-roller.js";
import { abilityCheck } from "./ability-checks.js";
import type { RollMode } from "./advantage.js";

export interface HideAttempt {
  /** Dexterity (Stealth) modifier */
  stealthModifier: number;
  /** Roll mode (advantage/disadvantage) */
  mode?: RollMode;
  /** Must have cover or obscurement */
  hasCoverOrObscurement: boolean;
  /** Can't hide if clearly visible */
  clearlyVisible: boolean;
}

export interface HideResult {
  success: boolean;
  stealthRoll: number;
  reason?: string;
}

/**
 * Attempt to hide using Dexterity (Stealth).
 * Returns the stealth check result - observers compare with their Perception.
 */
export function attemptHide(
  diceRoller: DiceRoller,
  attempt: HideAttempt,
): HideResult {
  // Pre-checks
  if (attempt.clearlyVisible) {
    return {
      success: false,
      stealthRoll: 0,
      reason: "You can't hide from someone who can see you clearly",
    };
  }

  if (!attempt.hasCoverOrObscurement) {
    return {
      success: false,
      stealthRoll: 0,
      reason: "You need cover or obscurement to hide",
    };
  }

  // Roll stealth check (DC 0 - we just need the roll total)
  const check = abilityCheck(diceRoller, {
    dc: 0,
    abilityModifier: attempt.stealthModifier,
    mode: attempt.mode ?? "normal",
  });

  return {
    success: true,
    stealthRoll: check.total,
  };
}

/**
 * Check if a hidden creature is detected by an observer.
 * Compare stealth roll vs observer's passive Perception (10 + Wisdom modifier + proficiency if applicable).
 */
export function detectHidden(
  stealthRoll: number,
  observerPassivePerception: number,
): boolean {
  return observerPassivePerception >= stealthRoll;
}

/**
 * Active search: observer makes a Wisdom (Perception) check vs stealth roll.
 */
export function searchForHidden(
  diceRoller: DiceRoller,
  stealthRoll: number,
  observerPerceptionModifier: number,
  mode?: RollMode,
): { detected: boolean; perceptionRoll: number } {
  const check = abilityCheck(diceRoller, {
    dc: 0,
    abilityModifier: observerPerceptionModifier,
    mode: mode ?? "normal",
  });

  return {
    detected: check.total >= stealthRoll,
    perceptionRoll: check.total,
  };
}

/**
 * Common ways stealth is broken (DM decides based on situation).
 */
export type StealthBreaker =
  | "attack"           // Making an attack reveals you
  | "cast-spell"       // Most spells have components that reveal you
  | "loud-noise"       // Shouting, knocking things over, etc.
  | "move-into-open"   // Leaving cover/obscurement
  | "damage-taken";    // Getting hit might give away position

export function breaksHidden(breaker: StealthBreaker): boolean {
  // All of these typically break hidden status
  return true;
}
