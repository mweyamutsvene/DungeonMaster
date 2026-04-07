import { crossesThroughReach, type Position } from "../../../../domain/rules/movement.js";
import { canMakeOpportunityAttack } from "../../../../domain/rules/opportunity-attack.js";
import { isAttackBlockedByCharm, normalizeConditions } from "../../../../domain/entities/combat/conditions.js";
import type { CombatantStateRecord } from "../../../types.js";
import { getPosition, hasReactionAvailable, normalizeResources, readBoolean } from "./resource-utils.js";

export interface DetectOpportunityAttacksInput {
  combatants: readonly CombatantStateRecord[];
  actor: CombatantStateRecord;
  from: Position;
  to: Position;
  pathCells?: readonly Position[];
  includeObserverFeatFlags?: boolean;
}

export interface OpportunityAttackDetection {
  combatant: CombatantStateRecord;
  reach: number;
  hasReaction: boolean;
  canAttack: boolean;
  canCastSpellAsOA: boolean;
  reducesSpeedToZero: boolean;
}

function movementLeavesReach(
  from: Position,
  to: Position,
  pathCells: readonly Position[] | undefined,
  observerPosition: Position,
  observerReach: number,
): boolean {
  if (pathCells && pathCells.length > 1) {
    let previous = from;
    for (const cell of pathCells) {
      if (crossesThroughReach({ from: previous, to: cell }, observerPosition, observerReach)) {
        return true;
      }
      previous = cell;
    }
    return false;
  }

  return crossesThroughReach({ from, to }, observerPosition, observerReach);
}

export function detectOpportunityAttacks(input: DetectOpportunityAttacksInput): OpportunityAttackDetection[] {
  const actorResources = normalizeResources(input.actor.resources);
  const isDisengaged = readBoolean(actorResources, "disengaged") ?? false;

  const detections: OpportunityAttackDetection[] = [];

  for (const other of input.combatants) {
    if (other.id === input.actor.id) continue;
    if (other.hpCurrent <= 0) continue;

    const otherResources = normalizeResources(other.resources);
    const otherPosition = getPosition(otherResources);
    if (!otherPosition) continue;

    const reachValue = otherResources.reach;
    const reach = typeof reachValue === "number" ? reachValue : 5;

    if (!movementLeavesReach(input.from, input.to, input.pathCells, otherPosition, reach)) {
      continue;
    }

    const hasReaction = hasReactionAvailable(otherResources);

    const otherConditions = normalizeConditions(other.conditions);
    const observerIncapacitated = otherConditions.some(
      (condition) => typeof condition.condition === "string" && condition.condition.toLowerCase() === "incapacitated",
    );
    const observerCharmedByTarget = isAttackBlockedByCharm(otherConditions, input.actor.id);

    const warCasterEnabled =
      input.includeObserverFeatFlags === true ? (readBoolean(otherResources, "warCasterEnabled") ?? false) : false;
    const sentinelEnabled =
      input.includeObserverFeatFlags === true ? (readBoolean(otherResources, "sentinelEnabled") ?? false) : false;

    const canAttack = canMakeOpportunityAttack(
      { reactionUsed: !hasReaction },
      {
        movingCreatureId: input.actor.id,
        observerId: other.id,
        disengaged: isDisengaged,
        canSee: true,
        observerIncapacitated,
        leavingReach: true,
        observerCharmedByTarget,
        warCasterEnabled,
        sentinelEnabled,
      },
    );

    detections.push({
      combatant: other,
      reach,
      hasReaction,
      canAttack: canAttack.canAttack,
      canCastSpellAsOA: canAttack.canCastSpellAsOA === true,
      reducesSpeedToZero: canAttack.reducesSpeedToZero === true,
    });
  }

  return detections;
}