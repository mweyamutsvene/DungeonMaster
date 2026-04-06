/**
 * D&D 5e 2024 Lucky Feat — Domain Foundation
 *
 * Lucky grants 3 Luck Points per long rest. A Luck Point lets
 * you reroll any d20 for an attack roll, ability check, or saving
 * throw you make — or impose a reroll on an attacker targeting you.
 *
 * This module provides the pure-function primitives for tracking
 * and spending Luck Points. Wiring into the roll machinery is
 * handled by application-layer services (not yet implemented).
 */

/** Default number of Luck Points granted by the Lucky feat. */
export const LUCKY_POINTS_MAX = 3;

/** Whether a Lucky reroll can be attempted (points remaining > 0). */
export function canUseLucky(luckyPointsRemaining: number): boolean {
  return luckyPointsRemaining > 0;
}

/**
 * Spend one Luck Point and return the new remaining count.
 * Returns 0 if already at 0 (never goes negative).
 */
export function useLuckyPoint(points: number): number {
  return Math.max(points - 1, 0);
}

/** Reset Luck Points (typically on a long rest). Returns the max value (3). */
export function resetLuckyPoints(): number {
  return LUCKY_POINTS_MAX;
}
