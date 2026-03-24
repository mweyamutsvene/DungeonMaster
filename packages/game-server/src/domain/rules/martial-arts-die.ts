/**
 * Martial Arts Die Scaling
 * 
 * Determines the Martial Arts die size based on Monk level per D&D 5e rules.
 */

import type { DiceRoller } from "./dice-roller.js";

export interface MartialArtsDie {
  dieSize: number; // e.g., 6 for 1d6
  diceCount: number; // always 1 for Martial Arts
  notation: string; // e.g., "1d6"
}

/**
 * Get the Martial Arts die size for a given monk level.
 * 
 * @param level - Monk level (1-20)
 * @returns Die size (6, 8, 10, or 12)
 */
export function getMartialArtsDieSize(level: number): number {
  if (level >= 17) return 12;
  if (level >= 11) return 10;
  if (level >= 5) return 8;
  return 6;
}

/**
 * Get the full Martial Arts die information for a given monk level.
 * 
 * @param level - Monk level (1-20)
 * @returns MartialArtsDie with size, count, and notation
 */
export function getMartialArtsDie(level: number): MartialArtsDie {
  const dieSize = getMartialArtsDieSize(level);
  return {
    dieSize,
    diceCount: 1,
    notation: `1d${dieSize}`,
  };
}

/**
 * Roll the Martial Arts die for a given monk level.
 * 
 * @param diceRoller - Deterministic dice roller
 * @param level - Monk level (1-20)
 * @returns Roll result (1 to die size)
 */
export function rollMartialArtsDie(diceRoller: DiceRoller, level: number): number {
  const dieSize = getMartialArtsDieSize(level);
  return diceRoller.rollDie(dieSize).total;
}
