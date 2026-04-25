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
  /** Highest passive Perception among observers contesting this hide attempt */
  observerPassivePerception?: number;
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

  if (
    typeof attempt.observerPassivePerception === "number" &&
    detectHidden(check.total, attempt.observerPassivePerception)
  ) {
    return {
      success: false,
      stealthRoll: check.total,
      reason: "An observer notices you",
    };
  }

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

// ----- Surprise auto-computation -----

/**
 * Minimal creature info needed for surprise computation.
 */
export interface SurpriseCreatureInfo {
  id: string;
  /** "party" for PCs + allied NPCs, "enemy" for hostile monsters */
  side: "party" | "enemy";
  /** True if the creature currently has the Hidden condition */
  isHidden: boolean;
  /** The stealth roll stored as a resource (from a previous Hide action), or undefined */
  stealthRoll?: number;
  /** Passive Perception — 10 + Wisdom(Perception) modifier. For monsters, from stat block. */
  passivePerception: number;
}

/**
 * Compute passive perception for a creature from its stat/sheet data.
 * D&D 5e 2024: Passive Perception = 10 + Wisdom(Perception) modifier.
 *
 * For monsters: `statBlock.passivePerception` is pre-computed.
 * For characters: 10 + perception skill modifier (or 10 + Wisdom modifier if no proficiency).
 */
export function getPassivePerception(data: {
  passivePerception?: number;
  skills?: Record<string, number>;
  abilityScores?: { wisdom?: number };
}): number {
  // If explicitly provided (monsters), use it
  if (typeof data.passivePerception === "number") return data.passivePerception;
  // If perception skill modifier is available, use it
  if (data.skills && typeof data.skills.perception === "number") return 10 + data.skills.perception;
  // Fall back to 10 + Wisdom modifier
  if (data.abilityScores?.wisdom !== undefined) {
    return 10 + Math.floor((data.abilityScores.wisdom - 10) / 2);
  }
  // Default passive perception
  return 10;
}

/**
 * Auto-compute surprise from creature states.
 * D&D 5e 2024: A creature is surprised if combat starts while it can't perceive any threats
 * (i.e., all enemies are Hidden and their stealth exceeds the creature's passive perception).
 *
 * Returns a list of creature IDs that are surprised, or undefined if no one is surprised.
 */
export function computeSurprise(
  creatures: SurpriseCreatureInfo[],
): string[] | undefined {
  const surprised: string[] = [];

  for (const creature of creatures) {
    // Get all enemies of this creature
    const enemies = creatures.filter((c) => c.side !== creature.side);
    if (enemies.length === 0) continue;

    // A creature is surprised if ALL enemies that are hidden have stealth > its passive perception
    // AND at least one enemy is hidden
    const hiddenEnemies = enemies.filter((e) => e.isHidden && e.stealthRoll !== undefined);
    if (hiddenEnemies.length === 0) continue;

    // All enemies must be hidden for the creature to be surprised
    // (if any enemy is visible, the creature is aware of threats)
    const visibleEnemies = enemies.filter((e) => !e.isHidden);
    if (visibleEnemies.length > 0) continue;

    // Check if ALL hidden enemies beat this creature's passive perception
    const allUndetected = hiddenEnemies.every(
      (e) => !detectHidden(e.stealthRoll!, creature.passivePerception),
    );

    if (allUndetected) {
      surprised.push(creature.id);
    }
  }

  return surprised.length > 0 ? surprised : undefined;
}
