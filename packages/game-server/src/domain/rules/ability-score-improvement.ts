/**
 * Ability Score Improvement (ASI) rules — D&D 5e 2024.
 *
 * At certain class levels a character gets an ASI: increase one ability score
 * by 2, or two ability scores by 1 each (max 20), OR take a feat.
 */

import type { CharacterClassId } from "../entities/classes/class-definition.js";
import { isCharacterClassId } from "../entities/classes/class-definition.js";

/** Stored record of a single ASI choice. */
export interface ASIChoice {
  /** Character level at which the ASI was applied. */
  level: number;
  /** "asi" = ability score increases, "feat" = feat selection. */
  type: "asi" | "feat";
  /** For type "asi": ability score increases, e.g. { strength: 2 } or { dexterity: 1, wisdom: 1 }. */
  scores?: Record<string, number>;
  /** For type "feat": the feat ID selected. */
  featId?: string;
}

/** Standard ASI levels for most classes. */
const STANDARD_ASI_LEVELS = [4, 8, 12, 16, 19];

/** Fighter gets bonus ASIs at 6 and 14. */
const FIGHTER_ASI_LEVELS = [4, 6, 8, 12, 14, 16, 19];

/** Rogue gets a bonus ASI at 10. */
const ROGUE_ASI_LEVELS = [4, 8, 10, 12, 16, 19];

/**
 * Return the levels at which a class gets Ability Score Improvements.
 * D&D 5e 2024: Most classes = 4, 8, 12, 16, 19.
 * Fighter = 4, 6, 8, 12, 14, 16, 19.
 * Rogue = 4, 8, 10, 12, 16, 19.
 */
export function getASILevels(classId: string): number[] {
  const normalized = classId.toLowerCase();
  if (normalized === "fighter") return [...FIGHTER_ASI_LEVELS];
  if (normalized === "rogue") return [...ROGUE_ASI_LEVELS];
  return [...STANDARD_ASI_LEVELS];
}

/**
 * Validate an ASI choice. Returns null when valid, or an error message.
 *
 * Rules:
 * - level must be an ASI level for the character's class
 * - type "asi": total increase must be exactly 2 (either +2 to one or +1/+1 to two)
 * - scores after increase must not exceed 20
 * - type "feat": featId must be non-empty
 */
export function validateASIChoice(
  choice: ASIChoice,
  classId: string,
  currentScores: Record<string, number>,
): string | null {
  const asiLevels = getASILevels(classId);
  if (!asiLevels.includes(choice.level)) {
    return `Level ${choice.level} is not an ASI level for class ${classId}. Valid levels: ${asiLevels.join(", ")}`;
  }

  if (choice.type === "asi") {
    if (!choice.scores || typeof choice.scores !== "object") {
      return "ASI choice of type 'asi' requires a 'scores' map";
    }

    const entries = Object.entries(choice.scores);
    if (entries.length === 0) {
      return "ASI 'scores' map must have at least one entry";
    }
    if (entries.length > 2) {
      return "ASI 'scores' map can have at most two entries (increase one by 2 or two by 1)";
    }

    const validAbilities = ["strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"];
    let totalIncrease = 0;

    for (const [ability, increase] of entries) {
      if (!validAbilities.includes(ability)) {
        return `Invalid ability: ${ability}`;
      }
      if (!Number.isInteger(increase) || increase < 1 || increase > 2) {
        return `Increase for ${ability} must be 1 or 2, got ${increase}`;
      }
      totalIncrease += increase;

      const currentScore = currentScores[ability] ?? 10;
      if (currentScore + increase > 20) {
        return `${ability} would exceed 20 (current: ${currentScore}, increase: ${increase})`;
      }
    }

    if (totalIncrease !== 2) {
      return `Total ASI increase must be exactly 2, got ${totalIncrease}`;
    }
  } else if (choice.type === "feat") {
    if (!choice.featId || typeof choice.featId !== "string" || choice.featId.trim().length === 0) {
      return "ASI choice of type 'feat' requires a non-empty 'featId'";
    }
  } else {
    return `Invalid ASI type: ${(choice as ASIChoice).type}. Must be 'asi' or 'feat'`;
  }

  return null;
}

/**
 * Apply ASI choices to base ability scores, returning the adjusted scores.
 * Only applies choices for levels ≤ the character's current level.
 */
export function applyASIChoices(
  baseScores: Record<string, number>,
  asiChoices: readonly ASIChoice[],
  characterLevel: number,
): Record<string, number> {
  const result = { ...baseScores };

  for (const choice of asiChoices) {
    if (choice.level > characterLevel) continue;
    if (choice.type !== "asi" || !choice.scores) continue;

    for (const [ability, increase] of Object.entries(choice.scores)) {
      const current = result[ability] ?? 10;
      result[ability] = Math.min(20, current + increase);
    }
  }

  return result;
}

/**
 * Collect feat IDs from ASI choices (for choices where type = "feat").
 */
export function collectASIFeatIds(asiChoices: readonly ASIChoice[], characterLevel: number): string[] {
  return asiChoices
    .filter(c => c.level <= characterLevel && c.type === "feat" && c.featId)
    .map(c => c.featId!);
}
