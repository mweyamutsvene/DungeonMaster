/**
 * AI Movement Planner — movement, positioning, and targeting helpers for the AI.
 *
 * Provides:
 * - Ranged/melee creature classification
 * - Best attack selection
 * - Adjacent enemy detection
 * - Cover-seeking positioning (for ranged combatants)
 * - Flanking position finding (for melee combatants)
 *
 * Layer: Application (AI module)
 */

import type { AiCombatContext } from "./ai-types.js";
import type { ScoredTarget } from "./ai-target-scorer.js";
import { getCoverLevel, hasLineOfSight } from "../../../../domain/rules/combat-map-sight.js";
import type { CombatMap } from "../../../../domain/rules/combat-map-types.js";
import { calculateDistance } from "../../../../domain/rules/movement.js";
import type { Position } from "../../../../domain/rules/movement.js";
import { isPositionPassable } from "../../../../domain/rules/combat-map-core.js";
import { isFlanking } from "../../../../domain/rules/flanking.js";

/**
 * Determine if a creature is primarily ranged based on its available attacks.
 */
export function isRangedCreature(combatant: AiCombatContext["combatant"]): boolean {
  const attacks = (combatant.attacks ?? []) as Array<{ name?: string; type?: string; kind?: string; reach?: number; range?: number | string }>;
  if (attacks.length === 0) return false;

  const rangedCount = attacks.filter(a => {
    const kind = (a.kind ?? a.type ?? "").toLowerCase();
    const name = (a.name ?? "").toLowerCase();
    return kind.includes("ranged") ||
      name.includes("longbow") || name.includes("shortbow") ||
      name.includes("crossbow") || name.includes("javelin") ||
      name.includes("sling") || name.includes("dart") ||
      name.includes("ray") || name.includes("bolt") ||
      name.includes("blast");
  }).length;

  return rangedCount > attacks.length / 2;
}

/**
 * Find the best attack from available attacks array.
 * Uses expected damage heuristic: avgDamage * hitProbability * damageTypeMultiplier.
 * hitProbability ≈ (21 - (targetAC - toHit)) / 20 clamped to [0.05, 0.95].
 * avgDamage = diceCount * (diceSides + 1) / 2 + damageBonus.
 * AI2-M5: Applies damage type multiplier based on target resistances/immunities/vulnerabilities.
 * Falls back to first available if no damage info.
 */
export function pickBestAttack(
  attacks: Array<{ name?: string; damage?: string; toHit?: number; damageType?: string }>,
  targetAC?: number,
  targetDefenses?: { damageImmunities?: string[]; damageResistances?: string[]; damageVulnerabilities?: string[] },
): string | undefined {
  if (attacks.length === 0) return undefined;

  const ac = targetAC ?? 13; // reasonable default AC assumption when unknown

  let best = attacks[0];
  let bestExpectedDamage = -1;

  for (const atk of attacks) {
    const toHit = atk.toHit ?? 0;
    const hitProb = Math.min(0.95, Math.max(0.05, (21 - (ac - toHit)) / 20));
    const avgDamage = parseAverageDamage(atk.damage);
    // AI2-M5: Apply damage type resistance/immunity/vulnerability
    const dmgMult = targetDefenses && atk.damageType
      ? getDamageTypeMultiplierForAttack(atk.damageType, targetDefenses)
      : 1;
    const expected = avgDamage * hitProb * dmgMult;

    if (expected > bestExpectedDamage) {
      bestExpectedDamage = expected;
      best = atk;
    }
  }
  return best?.name;
}

/**
 * Damage type multiplier for attack selection.
 * Returns: 0.01 for immune (not 0 — still a valid fallback), 0.5 for resistant, 2 for vulnerable, 1 otherwise.
 */
function getDamageTypeMultiplierForAttack(
  damageType: string,
  defenses: { damageImmunities?: string[]; damageResistances?: string[]; damageVulnerabilities?: string[] },
): number {
  const normalized = damageType.trim().toLowerCase();
  const immunities = (defenses.damageImmunities ?? []).map(s => s.trim().toLowerCase());
  if (immunities.includes(normalized)) return 0.01; // Nearly zero but not zero — still a valid fallback
  const resistances = (defenses.damageResistances ?? []).map(s => s.trim().toLowerCase());
  const vulnerabilities = (defenses.damageVulnerabilities ?? []).map(s => s.trim().toLowerCase());
  if (resistances.includes(normalized) && vulnerabilities.includes(normalized)) return 1;
  if (resistances.includes(normalized)) return 0.5;
  if (vulnerabilities.includes(normalized)) return 2;
  return 1;
}

/**
 * Parse a D&D damage formula string into average damage.
 * Handles: "2d6+3", "1d8", "3d10+5", "1d6+1d4+2", etc.
 * Returns 0 if unparseable.
 */
function parseAverageDamage(damage: string | undefined): number {
  if (!damage) return 0;

  let total = 0;

  // Sum all NdM dice averages
  const dicePattern = /(\d+)d(\d+)/g;
  let match: RegExpExecArray | null;
  while ((match = dicePattern.exec(damage)) !== null) {
    const count = parseInt(match[1]!, 10);
    const sides = parseInt(match[2]!, 10);
    total += count * (sides + 1) / 2;
  }

  // Strip dice expressions, then sum remaining signed numbers as flat bonuses
  const stripped = damage.replace(/\d+d\d+/g, "").replace(/\s/g, "");
  const numPattern = /([+-]?\d+)/g;
  let numMatch: RegExpExecArray | null;
  while ((numMatch = numPattern.exec(stripped)) !== null) {
    total += parseInt(numMatch[1]!, 10);
  }

  return Math.max(0, total);
}

/**
 * Check if any living enemy is within melee reach (5ft) of the combatant.
 */
export function hasAdjacentEnemy(
  combatantPos: { x: number; y: number } | undefined,
  enemies: AiCombatContext["enemies"],
): boolean {
  if (!combatantPos) return false;
  return enemies.some(
    e => e.hp.current > 0 && e.distanceFeet !== undefined && e.distanceFeet <= 5,
  );
}

/**
 * AI-M7: Find the best cover-seeking position for a ranged combatant.
 */
export function findCoverPosition(
  currentPos: { x: number; y: number },
  primaryTarget: ScoredTarget,
  enemies: AiCombatContext["enemies"],
  speed: number,
  map: CombatMap,
): { x: number; y: number } | undefined {
  const targetPos = primaryTarget.enemy.position;
  if (!targetPos) return undefined;

  const gridSize = map.gridSize || 5;
  const maxRange = 60;
  const searchRadius = Math.floor(speed / gridSize);

  const candidates: Array<{
    pos: { x: number; y: number };
    coverScore: number;
    distToTarget: number;
  }> = [];

  for (let dx = -searchRadius; dx <= searchRadius; dx++) {
    for (let dy = -searchRadius; dy <= searchRadius; dy++) {
      const pos = {
        x: currentPos.x + dx * gridSize,
        y: currentPos.y + dy * gridSize,
      };

      if (pos.x === currentPos.x && pos.y === currentPos.y) continue;

      const moveDist = calculateDistance(currentPos, pos);
      if (moveDist > speed) continue;

      if (!isPositionPassable(map, pos)) continue;

      const los = hasLineOfSight(map, pos, targetPos);
      if (!los.visible) continue;

      const distToTarget = calculateDistance(pos, targetPos);
      if (distToTarget > maxRange) continue;
      if (distToTarget < 10) continue;

      let coverScore = 0;
      for (const enemy of enemies) {
        if (!enemy.position || enemy.hp.current <= 0) continue;
        const cover = getCoverLevel(map, enemy.position, pos);
        if (cover === "half") coverScore += 1;
        else if (cover === "three-quarters") coverScore += 2;
        else if (cover === "full") coverScore += 3;
      }

      if (coverScore > 0) {
        candidates.push({ pos, coverScore, distToTarget });
      }
    }
  }

  if (candidates.length === 0) return undefined;

  candidates.sort((a, b) => {
    if (b.coverScore !== a.coverScore) return b.coverScore - a.coverScore;
    const aRangePenalty = Math.abs(a.distToTarget - 30);
    const bRangePenalty = Math.abs(b.distToTarget - 30);
    return aRangePenalty - bRangePenalty;
  });

  return candidates[0]!.pos;
}

/**
 * AI-L1: Find a flanking position adjacent to the target.
 */
export function findFlankingPosition(
  currentPos: Position,
  targetPos: Position,
  allyPositions: readonly Position[],
  speed: number,
  map?: CombatMap,
  gridSize: number = 5,
): Position | undefined {
  for (const allyPos of allyPositions) {
    const dx = Math.abs(allyPos.x - targetPos.x);
    const dy = Math.abs(allyPos.y - targetPos.y);
    if (Math.max(dx, dy) === 0 || Math.max(dx, dy) > gridSize) continue;

    const flankPos: Position = {
      x: 2 * targetPos.x - allyPos.x,
      y: 2 * targetPos.y - allyPos.y,
    };

    if (!isFlanking(flankPos, targetPos, allyPos, gridSize)) continue;

    const dist = calculateDistance(currentPos, flankPos);
    if (dist > speed) continue;

    if (map && !isPositionPassable(map, flankPos)) continue;

    return flankPos;
  }
  return undefined;
}
