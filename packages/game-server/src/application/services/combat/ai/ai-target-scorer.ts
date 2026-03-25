/**
 * AI Target Scorer — Reusable utility for scoring and ranking enemy targets.
 *
 * Layer: Application (AI module)
 * Used by: DeterministicAiDecisionMaker, optionally by LLM context enrichment.
 *
 * Score heuristics (higher = more attractive target):
 * - Low HP ratio → easier to finish off (focus fire)
 * - Low AC → easier to hit
 * - Concentration → breaking concentration removes zone/buff spells
 * - Debilitating conditions (stunned, paralyzed) → guaranteed advantage, easy target
 * - Proximity → closer = less movement cost to reach
 * - Prone → advantage on melee attacks within 5 ft
 */

import type { AiCombatContext } from "./ai-types.js";

/** A scored enemy target with breakdown. */
export interface ScoredTarget {
  name: string;
  /** Total composite score (higher = more attractive). */
  score: number;
  /** Distance in feet from the scorer, or Infinity if unknown. */
  distanceFeet: number;
  /** The raw enemy entry from context. */
  enemy: AiCombatContext["enemies"][number];
}

/** Weights for each scoring factor. Tunable. */
const WEIGHTS = {
  /** Bonus per percentage of HP missing (0-100 scale). Max contribution: 100 * 1.0 = 100 */
  hpMissing: 1.0,
  /** Bonus for low AC. Base 20 minus AC, so AC 10 → +10, AC 20 → 0. */
  lowAc: 2.0,
  /** Flat bonus for maintaining concentration (high-value disruption target). */
  concentration: 40,
  /** Flat bonus for being stunned (attack advantage + auto-fail STR/DEX saves). */
  stunned: 35,
  /** Flat bonus for being paralyzed (auto-crit on hit within 5ft). */
  paralyzed: 45,
  /** Flat bonus for being prone (advantage on melee within 5ft). */
  prone: 15,
  /** Flat bonus for being restrained (advantage on attacks against). */
  restrained: 20,
  /** Flat bonus for being frightened (disadvantage on checks). */
  frightened: 10,
  /** Penalty per 5 feet of distance (proximity preference). */
  distancePenaltyPer5ft: 2.0,
  /** Bonus for being incapacitated (can't take actions/reactions). */
  incapacitated: 25,
};

/**
 * Score and rank all living enemies from the perspective of a combatant.
 *
 * @param selfPosition - The scorer's current position (for distance calculations).
 * @param enemies - The enemy list from AiCombatContext.
 * @returns Sorted array of scored targets (highest score first).
 */
export function scoreTargets(
  selfPosition: { x: number; y: number } | undefined,
  enemies: AiCombatContext["enemies"],
): ScoredTarget[] {
  const scored: ScoredTarget[] = [];

  for (const enemy of enemies) {
    // Skip dead enemies
    if (enemy.hp.current <= 0) continue;

    let score = 0;

    // 1. HP ratio — prefer low-HP targets (focus fire)
    const hpMissingPercent = 100 - enemy.hp.percentage;
    score += hpMissingPercent * WEIGHTS.hpMissing;

    // 2. AC — prefer low-AC targets (easier to hit)
    if (enemy.ac !== undefined) {
      const acBonus = Math.max(0, 20 - enemy.ac);
      score += acBonus * WEIGHTS.lowAc;
    }

    // 3. Concentration — high-value disruption target
    if (enemy.concentrationSpell) {
      score += WEIGHTS.concentration;
    }

    // 4. Conditions — exploitable weaknesses
    const conditions = (enemy.conditions ?? []).map(c => c.toLowerCase());
    if (conditions.includes("stunned")) score += WEIGHTS.stunned;
    if (conditions.includes("paralyzed")) score += WEIGHTS.paralyzed;
    if (conditions.includes("prone")) score += WEIGHTS.prone;
    if (conditions.includes("restrained")) score += WEIGHTS.restrained;
    if (conditions.includes("frightened")) score += WEIGHTS.frightened;
    if (conditions.includes("incapacitated")) score += WEIGHTS.incapacitated;

    // 5. Distance penalty — prefer closer targets
    let distanceFeet = Infinity;
    if (enemy.distanceFeet !== undefined) {
      distanceFeet = enemy.distanceFeet;
    } else if (selfPosition && enemy.position) {
      // Calculate Euclidean distance in grid units (5ft per cell)
      const dx = selfPosition.x - enemy.position.x;
      const dy = selfPosition.y - enemy.position.y;
      distanceFeet = Math.round(Math.sqrt(dx * dx + dy * dy) * 5);
    }

    if (distanceFeet !== Infinity) {
      score -= (distanceFeet / 5) * WEIGHTS.distancePenaltyPer5ft;
    }

    scored.push({ name: enemy.name, score, distanceFeet, enemy });
  }

  // Sort by descending score
  scored.sort((a, b) => b.score - a.score);
  return scored;
}
