/**
 * Martial Arts Die Scaling
 * 
 * Determines the Martial Arts die size based on Monk level per D&D 5e rules.
 */

export interface MartialArtsDie {
  dieSize: number; // e.g., 6 for 1d6
  diceCount: number; // always 1 for Martial Arts
  notation: string; // e.g., "1d6"
}

/**
 * Martial Arts die progression by monk level
 */
const MARTIAL_ARTS_DIE_BY_LEVEL: Record<number, number> = {
  1: 6,   // 1d6 at levels 1-4
  5: 8,   // 1d8 at levels 5-10
  11: 10, // 1d10 at levels 11-16
  17: 12, // 1d12 at levels 17+
};

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
 * @param level - Monk level (1-20)
 * @returns Random roll result (1 to die size)
 */
export function rollMartialArtsDie(level: number): number {
  const dieSize = getMartialArtsDieSize(level);
  return Math.floor(Math.random() * dieSize) + 1;
}
