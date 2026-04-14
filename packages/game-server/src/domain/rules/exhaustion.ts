/**
 * Exhaustion Rules — D&D 5e 2024.
 *
 * 2024 revamped exhaustion: each level gives −2 on all d20 Tests and −5 ft speed.
 * 10 levels = death.
 *
 * Layer: Domain (pure functions, no side effects).
 */

/** Maximum exhaustion level before death. */
export const EXHAUSTION_LETHAL_LEVEL = 10;

/** Per-level penalty to all d20 Tests (ability checks, attack rolls, saving throws). */
export const EXHAUSTION_D20_PENALTY_PER_LEVEL = 2;

/** Per-level speed reduction in feet. */
export const EXHAUSTION_SPEED_PENALTY_PER_LEVEL = 5;

export interface ExhaustionPenalty {
  /** Total penalty subtracted from d20 rolls (always ≥ 0). */
  d20Penalty: number;
  /** Total speed reduction in feet (always ≥ 0). */
  speedReduction: number;
}

/**
 * Compute the exhaustion penalties for a given exhaustion level.
 * Levels are clamped to 0–10.
 */
export function getExhaustionPenalty(level: number): ExhaustionPenalty {
  const clamped = Math.max(0, Math.min(EXHAUSTION_LETHAL_LEVEL, Math.floor(level)));
  return {
    d20Penalty: clamped * EXHAUSTION_D20_PENALTY_PER_LEVEL,
    speedReduction: clamped * EXHAUSTION_SPEED_PENALTY_PER_LEVEL,
  };
}

/**
 * Returns true if the exhaustion level is lethal (≥ 10).
 */
export function isLethalExhaustion(level: number): boolean {
  return Math.floor(level) >= EXHAUSTION_LETHAL_LEVEL;
}

/**
 * Apply exhaustion penalty to a d20 roll result.
 * The result is floored at 1 (a natural roll can't go below 1 after penalties).
 */
export function applyExhaustionToD20(roll: number, exhaustionLevel: number): number {
  const { d20Penalty } = getExhaustionPenalty(exhaustionLevel);
  return Math.max(1, roll - d20Penalty);
}
