/**
 * D&D 5e Grapple and Shove Mechanics
 *
 * Rules:
 * - Both use your Attack action (replaces one attack if you have Extra Attack)
 * - Contested check: Attacker's Athletics vs Target's Athletics or Acrobatics (target chooses)
 * - Target must be no more than one size larger than you
 * - You need at least one free hand
 */

import type { DiceRoller } from "./dice-roller.js";
import { abilityCheck } from "./ability-checks.js";
import type { RollMode } from "./advantage.js";

export interface GrappleAttempt {
  /** Attacker's Strength (Athletics) modifier */
  attackerAthleticsModifier: number;
  /** Target's choice: Athletics or Acrobatics modifier (whichever is higher usually) */
  targetContestModifier: number;
  /** Attack roll mode */
  attackerMode?: RollMode;
  /** Target roll mode */
  targetMode?: RollMode;
  /** Size difference check (target can't be more than 1 size larger) */
  targetTooLarge: boolean;
  /** Attacker needs at least one free hand */
  hasFreeHand: boolean;
}

export interface GrappleResult {
  success: boolean;
  attackerRoll: number;
  targetRoll: number;
  reason?: string;
}

/**
 * Resolve a grapple attempt.
 * Attacker rolls Athletics, target rolls Athletics or Acrobatics (their choice).
 */
export function resolveGrapple(
  diceRoller: DiceRoller,
  attempt: GrappleAttempt,
): GrappleResult {
  // Pre-checks
  if (attempt.targetTooLarge) {
    return {
      success: false,
      attackerRoll: 0,
      targetRoll: 0,
      reason: "Target is too large to grapple",
    };
  }

  if (!attempt.hasFreeHand) {
    return {
      success: false,
      attackerRoll: 0,
      targetRoll: 0,
      reason: "You need at least one free hand to grapple",
    };
  }

  // Roll contested Athletics checks (DC 0 for contested - we just need the roll)
  const attackerCheck = abilityCheck(diceRoller, {
    dc: 0,
    abilityModifier: attempt.attackerAthleticsModifier,
    mode: attempt.attackerMode ?? "normal",
  });

  const targetCheck = abilityCheck(diceRoller, {
    dc: 0,
    abilityModifier: attempt.targetContestModifier,
    mode: attempt.targetMode ?? "normal",
  });

  const success = attackerCheck.total >= targetCheck.total;

  return {
    success,
    attackerRoll: attackerCheck.total,
    targetRoll: targetCheck.total,
  };
}

export interface ShoveAttempt {
  /** Attacker's Strength (Athletics) modifier */
  attackerAthleticsModifier: number;
  /** Target's choice: Athletics or Acrobatics modifier */
  targetContestModifier: number;
  /** Attack roll mode */
  attackerMode?: RollMode;
  /** Target roll mode */
  targetMode?: RollMode;
  /** Size difference check */
  targetTooLarge: boolean;
  /** What you're trying to do: push 5ft away or knock prone */
  shoveType: "push" | "prone";
}

export interface ShoveResult {
  success: boolean;
  attackerRoll: number;
  targetRoll: number;
  shoveType: "push" | "prone";
  reason?: string;
}

/**
 * Resolve a shove attempt (push away or knock prone).
 * Same mechanics as grapple but different effect.
 */
export function resolveShove(
  diceRoller: DiceRoller,
  attempt: ShoveAttempt,
): ShoveResult {
  // Pre-checks
  if (attempt.targetTooLarge) {
    return {
      success: false,
      attackerRoll: 0,
      targetRoll: 0,
      shoveType: attempt.shoveType,
      reason: "Target is too large to shove",
    };
  }

  // Roll contested checks (DC 0 for contested - we just need the roll)
  const attackerCheck = abilityCheck(diceRoller, {
    dc: 0,
    abilityModifier: attempt.attackerAthleticsModifier,
    mode: attempt.attackerMode ?? "normal",
  });

  const targetCheck = abilityCheck(diceRoller, {
    dc: 0,
    abilityModifier: attempt.targetContestModifier,
    mode: attempt.targetMode ?? "normal",
  });

  const success = attackerCheck.total >= targetCheck.total;

  return {
    success,
    attackerRoll: attackerCheck.total,
    targetRoll: targetCheck.total,
    shoveType: attempt.shoveType,
  };
}

/**
 * Check if target is too large to grapple/shove.
 * Target can be at most one size category larger than attacker.
 */
export function isTargetTooLarge(
  attackerSize: CreatureSize,
  targetSize: CreatureSize,
): boolean {
  const sizeOrder: CreatureSize[] = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"];
  const attackerIndex = sizeOrder.indexOf(attackerSize);
  const targetIndex = sizeOrder.indexOf(targetSize);

  // Target can be at most 1 size larger
  return targetIndex > attackerIndex + 1;
}

export type CreatureSize = "Tiny" | "Small" | "Medium" | "Large" | "Huge" | "Gargantuan";
