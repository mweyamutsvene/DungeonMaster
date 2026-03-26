/**
 * Evasion — Monk 7, Rogue 7
 *
 * D&D 5e 2024: When subjected to an effect that allows a DEX saving throw
 * to take half damage:
 * - Success → take NO damage (instead of half)
 * - Failure → take HALF damage (instead of full)
 */

import { classHasFeature } from "../entities/classes/registry.js";
import { EVASION } from "../entities/classes/feature-keys.js";

/**
 * Apply the Evasion feature to damage from a DEX saving throw.
 *
 * @param baseDamage    - The full damage amount before save/evasion adjustments
 * @param saveSucceeded - Whether the DEX saving throw was successful
 * @param hasEvasion    - Whether the creature has the Evasion feature
 * @param halfOnSave    - Whether the effect normally deals half damage on save (default: true)
 * @returns Adjusted damage amount
 */
export function applyEvasion(
  baseDamage: number,
  saveSucceeded: boolean,
  hasEvasion: boolean,
  halfOnSave: boolean = true,
): number {
  if (hasEvasion) {
    // Evasion: success → 0, failure → half
    return saveSucceeded ? 0 : Math.floor(baseDamage / 2);
  }
  // Normal: success → half (if halfOnSave) or 0, failure → full
  if (saveSucceeded) {
    return halfOnSave ? Math.floor(baseDamage / 2) : 0;
  }
  return baseDamage;
}

/**
 * Check if a creature has the Evasion feature based on class and level.
 *
 * @param className - The creature's class name (e.g., "monk", "rogue")
 * @param level     - The creature's class level
 * @returns true if the creature has Evasion
 */
export function creatureHasEvasion(className: string | undefined, level: number): boolean {
  if (!className) return false;
  return classHasFeature(className.toLowerCase(), EVASION, level);
}
