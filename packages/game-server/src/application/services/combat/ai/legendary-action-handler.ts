/**
 * LegendaryActionHandler — Deterministic AI for choosing legendary actions between turns.
 *
 * D&D 5e 2024 rules:
 * - Immediately after another creature's turn ends, a legendary creature can spend
 *   charges to take a legendary action.
 * - Cannot use legendary actions while Incapacitated or otherwise unable to act.
 * - Charges reset at the START of the monster's own turn.
 *
 * Heuristics:
 * 1. Spread legendary actions across the round (don't dump all on first opportunity)
 * 2. Attack if a suitable target is adjacent
 * 3. Move (half speed, no OA) if out of position and no targets in reach
 * 4. Use special abilities when high value
 *
 * Layer: Application (AI module)
 */

import type { CombatantStateRecord } from "../../../types.js";
import { readConditionNames } from "../../../../domain/entities/combat/conditions.js";
import {
  getLegendaryActionsRemaining,
  getLegendaryActionDefs,
  getLegendaryActionCharges,
  normalizeResources,
} from "../helpers/resource-utils.js";
import { calculateDistance, type Position } from "../../../../domain/rules/movement.js";

/** Result of a legendary action decision */
export interface LegendaryActionDecision {
  /** The legendary action to use */
  actionName: string;
  /** Cost in charges */
  cost: number;
  /** What type of action this is */
  actionType: "attack" | "move" | "special";
  /** For attack actions: which attack to use */
  attackName?: string;
  /** For attack actions: target combatant ID */
  targetId?: string;
  /** Narration text */
  narration: string;
}

/**
 * Choose a legendary action for a boss monster to use after another creature's turn.
 *
 * @param boss - The legendary creature's combatant record
 * @param allCombatants - All combatants in the encounter
 * @param turnNumber - How many turns have passed since the boss's last turn
 *                     (used to spread actions across the round)
 * @returns A legendary action decision, or null if no action should be taken
 */
export function chooseLegendaryAction(
  boss: CombatantStateRecord,
  allCombatants: readonly CombatantStateRecord[],
  turnNumber: number,
): LegendaryActionDecision | null {
  // Check if boss can act
  const conditions = readConditionNames(boss.conditions).map(c => c.toLowerCase());
  if (
    conditions.includes("incapacitated") ||
    conditions.includes("stunned") ||
    conditions.includes("paralyzed") ||
    conditions.includes("unconscious") ||
    boss.hpCurrent <= 0
  ) {
    return null;
  }

  const remaining = getLegendaryActionsRemaining(boss.resources);
  if (remaining <= 0) return null;

  const maxCharges = getLegendaryActionCharges(boss.resources);
  const defs = getLegendaryActionDefs(boss.resources);
  if (defs.length === 0) return null;

  // Heuristic: spread actions across the round. Count how many combatants
  // take turns between the boss's turns. Use 1 legendary action every
  // ~ceil(totalNonBoss / maxCharges) turns. On the last opportunity before
  // the boss's own turn, spend any remaining charges.
  const nonBossCombatants = allCombatants.filter(c => c.id !== boss.id && c.hpCurrent > 0);
  const turnsPerCharge = nonBossCombatants.length > 0
    ? Math.max(1, Math.ceil(nonBossCombatants.length / maxCharges))
    : 1;

  // Only act every `turnsPerCharge` turns (spread across round)
  // Exception: if it's the last opportunity (turn matches count of non-boss combatants)
  const isLastOpportunity = turnNumber >= nonBossCombatants.length;
  if (!isLastOpportunity && turnNumber % turnsPerCharge !== 0) {
    return null;
  }

  // Get boss position
  const bossRes = normalizeResources(boss.resources);
  const bossPos = bossRes.position as Position | undefined;

  // Find enemies (different faction than boss)
  const bossFaction = boss.monster?.faction ?? boss.npc?.faction ?? boss.character?.faction ?? "enemy";
  const enemies = allCombatants.filter(c => {
    if (c.id === boss.id) return false;
    if (c.hpCurrent <= 0) return false;
    const cFaction = c.character?.faction ?? c.monster?.faction ?? c.npc?.faction ?? "party";
    return cFaction !== bossFaction;
  });

  // Sort available actions by cost (prefer cheap actions to preserve charges)
  const affordableActions = defs
    .filter(d => d.cost <= remaining)
    .sort((a, b) => a.cost - b.cost);

  if (affordableActions.length === 0) return null;

  // Priority 1: Attack if enemy is within reach (5ft)
  const attackAction = affordableActions.find(a => a.actionType === "attack");
  if (attackAction && bossPos) {
    const adjacentEnemy = findClosestEnemy(bossPos, enemies);
    if (adjacentEnemy && adjacentEnemy.distance <= 10) {
      return {
        actionName: attackAction.name,
        cost: attackAction.cost,
        actionType: "attack",
        attackName: attackAction.attackName,
        targetId: adjacentEnemy.id,
        narration: `The boss uses a legendary action: ${attackAction.name}!`,
      };
    }
  }

  // Priority 2: Move if out of position (no enemies in reach) and move action available
  const moveAction = affordableActions.find(a => a.actionType === "move");
  if (moveAction && bossPos && enemies.length > 0) {
    const closest = findClosestEnemy(bossPos, enemies);
    if (closest && closest.distance > 10) {
      return {
        actionName: moveAction.name,
        cost: moveAction.cost,
        actionType: "move",
        narration: `The boss uses a legendary action: ${moveAction.name}!`,
      };
    }
  }

  // Priority 3: If it's the last opportunity, use an attack even if no target in reach
  // (the AI turn orchestrator will handle targeting)
  if (isLastOpportunity && remaining > 0) {
    const anyAction = affordableActions[0];
    if (anyAction) {
      const target = enemies.length > 0 && bossPos ? findClosestEnemy(bossPos, enemies) : undefined;
      return {
        actionName: anyAction.name,
        cost: anyAction.cost,
        actionType: anyAction.actionType,
        attackName: anyAction.attackName,
        targetId: target?.id,
        narration: `The boss uses a legendary action: ${anyAction.name}!`,
      };
    }
  }

  return null;
}

/** Find the closest living enemy to a position. */
function findClosestEnemy(
  from: Position,
  enemies: readonly CombatantStateRecord[],
): { id: string; distance: number } | undefined {
  let closest: { id: string; distance: number } | undefined;
  for (const e of enemies) {
    const eRes = normalizeResources(e.resources);
    const ePos = eRes.position as Position | undefined;
    if (!ePos) continue;
    const dist = calculateDistance(from, ePos);
    if (!closest || dist < closest.distance) {
      closest = { id: e.id, distance: dist };
    }
  }
  return closest;
}
