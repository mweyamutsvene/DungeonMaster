/**
 * MoveAwayFromHandler — executes AI moveAwayFrom decisions: retreat pathfinding away from a target.
 */

import type { AiActionHandler, AiActionHandlerContext, AiActionHandlerDeps, AiHandlerResult } from "../ai-action-handler.js";
import { normalizeConditions, hasCondition } from "../../../../../domain/entities/combat/conditions.js";
import { calculateDistance } from "../../../../../domain/rules/movement.js";
import { findPath, findRetreatPosition } from "../../../../../domain/rules/pathfinding.js";
import { getEffectiveSpeed } from "../../helpers/resource-utils.js";
import { resolveAiMovement } from "../ai-movement-resolver.js";
import { getMapZones } from "../../../../../domain/rules/combat-map.js";
import { buildPathNarration } from "../../tabletop/path-narrator.js";
import type { CombatMap } from "../../../../../domain/rules/combat-map.js";
import type { CombatZone } from "../../../../../domain/entities/combat/zones.js";

export class MoveAwayFromHandler implements AiActionHandler {
  handles(action: string): boolean {
    return action === "moveAwayFrom";
  }

  async execute(ctx: AiActionHandlerContext, deps: AiActionHandlerDeps): Promise<AiHandlerResult> {
    const { sessionId, encounterId, aiCombatant, decision, allCombatants, actorRef } = ctx;
    const { combat, combatantResolver, aiLog, executeBonusAction } = deps;

    if (!decision.target) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: moveAwayFrom requires a target name",
        data: { reason: "missing_target" },
      };
    }

    if (!actorRef) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Invalid combatant reference",
        data: { reason: "invalid_combatant_reference" },
      };
    }

    const resources = (aiCombatant.resources as Record<string, unknown>) ?? {};
    const currentPos = resources.position as { x: number; y: number } | undefined;
    if (!currentPos) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Actor has no position",
        data: { reason: "no_actor_position" },
      };
    }

    const targetCombatant = await deps.findCombatantByName(decision.target, allCombatants);
    if (!targetCombatant) {
      return {
        action: decision.action,
        ok: false,
        summary: `Failed: Target "${decision.target}" not found`,
        data: { reason: "target_not_found" },
      };
    }

    const targetResources = (targetCombatant.resources as Record<string, unknown>) ?? {};
    const targetPos = targetResources.position as { x: number; y: number } | undefined;
    if (!targetPos) {
      return {
        action: decision.action,
        ok: false,
        summary: `Failed: Target "${decision.target}" has no position`,
        data: { reason: "target_no_position" },
      };
    }

    const speed = getEffectiveSpeed(aiCombatant.resources);
    const hasDashed = (resources.dashed as boolean) ?? false;
    let effectiveSpeed = hasDashed ? speed * 2 : speed;

    const aiConditions = normalizeConditions(aiCombatant.conditions as unknown[]);
    const isProne = hasCondition(aiConditions, "Prone");
    if (isProne) {
      const standUpCost = Math.ceil(speed / 2);
      effectiveSpeed -= standUpCost;
      if (effectiveSpeed <= 0) {
        return {
          action: decision.action,
          ok: false,
          summary: `Failed: Standing from Prone costs ${Math.ceil(speed / 2)}ft, no movement remaining`,
          data: { reason: "prone_no_movement" },
        };
      }
    }

    let combatMap: CombatMap | undefined;
    try {
      const encounter = await combat.getEncounterById(encounterId);
      combatMap = encounter?.mapData as unknown as CombatMap | undefined;
    } catch { /* No map */ }

    const occupiedPositions = allCombatants
      .filter((c) => c.id !== aiCombatant.id)
      .map((c) => (c.resources as Record<string, unknown>)?.position as { x: number; y: number })
      .filter((p): p is { x: number; y: number } => !!p && typeof p.x === "number" && typeof p.y === "number");

    let zones: CombatZone[] | undefined;
    if (combatMap) {
      zones = getMapZones(combatMap);
    }

    const retreatDest = findRetreatPosition(
      combatMap,
      currentPos,
      targetPos,
      effectiveSpeed,
      occupiedPositions,
      zones,
    );

    const retreatDistance = calculateDistance(currentPos, retreatDest);
    if (retreatDistance < 1) {
      return {
        action: decision.action,
        ok: true,
        summary: `Cannot retreat further from ${decision.target} — surrounded or blocked`,
        data: { movedFeet: 0, blocked: true },
      };
    }

    let pathCells: { x: number; y: number }[] | undefined;
    let pathCostFeet: number | undefined;
    let pathNarrationHints: string[] | undefined;

    if (combatMap) {
      const pathResult = findPath(combatMap, currentPos, retreatDest, {
        maxCostFeet: effectiveSpeed,
        occupiedPositions,
        zones,
      });
      if (pathResult.blocked && pathResult.path.length === 0 && !pathResult.reachablePosition) {
        // No path exists at all — destination is completely unreachable.
        // After the findRetreatPosition domain fix this should never happen, but
        // guard defensively against edge-cases (e.g., race conditions in map state).
        return {
          action: decision.action,
          ok: true,
          summary: `Cannot retreat from ${decision.target} — path completely blocked`,
          data: { movedFeet: 0, blocked: true },
        };
      }
      if (pathResult.reachablePosition) {
        // Partial path: update destination to the actual reachable endpoint.
        retreatDest.x = pathResult.reachablePosition.x;
        retreatDest.y = pathResult.reachablePosition.y;
      }
      pathCells = pathResult.path;
      pathCostFeet = pathResult.totalCostFeet;
      pathNarrationHints = pathResult.narrationHints;
    }

    const actorName = await combatantResolver.getName(actorRef, aiCombatant);
    const targetName = await combatantResolver.getName(
      deps.toCombatantRef(targetCombatant) ?? actorRef,
      targetCombatant,
    );

    const outcome = await resolveAiMovement(deps.getMovementDeps(), {
      sessionId, encounterId,
      aiCombatant, actorRef, allCombatants,
      currentPos, finalDestination: retreatDest,
      effectiveSpeed, resources,
      pathCells, pathCostFeet, pathNarrationHints,
    });

    if (outcome.kind === "aborted_by_trigger") {
      return {
        action: decision.action,
        ok: false,
        summary: `${outcome.message} Knocked out before retreating.`,
        data: { reason: "knocked_out_by_movement_trigger" },
      };
    }

    if (outcome.kind === "player_oa_pending") {
      return {
        action: decision.action,
        ok: true,
        summary: `Retreating from ${targetName} — awaiting ${outcome.playerOAsCount} player OA(s)`,
        data: {
          awaitingPlayerInput: true,
          playerOAsCount: outcome.playerOAsCount,
          pendingActionId: outcome.pendingActionId,
        },
      };
    }

    const bonusResult = await executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);

    if (outcome.kind === "no_reactions") {
      const newDist = Math.round(calculateDistance(retreatDest, targetPos));
      const mainSummary = `${actorName} retreats ${outcome.pathCostFeet}ft from ${targetName} (now ${newDist}ft away)`;
      const fullSummary = bonusResult ? `${mainSummary}. ${bonusResult.summary}` : mainSummary;
      return {
        action: decision.action,
        ok: true,
        summary: fullSummary,
        data: {
          movedFeet: outcome.pathCostFeet,
          destination: retreatDest,
          targetName,
          retreatedFromDistance: Math.round(calculateDistance(currentPos, targetPos)),
          newDistance: newDist,
          ...(bonusResult ? { bonusAction: bonusResult } : {}),
        },
      };
    }

    // outcome.kind === "completed"
    const newDist = Math.round(calculateDistance(retreatDest, targetPos));
    const usedCount = outcome.aiDecisions.filter((d: any) => d.used).length;
    const oaSummary = outcome.opportunityAttacks.length > 0
      ? ` Triggered ${usedCount}/${outcome.opportunityAttacks.length} OA(s).`
      : "";
    const mainSummary = `${actorName} retreats ${outcome.movedFeet}ft from ${targetName} (now ${newDist}ft away).${oaSummary}`;
    const fullSummary = bonusResult ? `${mainSummary} ${bonusResult.summary}` : mainSummary;

    return {
      action: decision.action,
      ok: true,
      summary: fullSummary,
      data: {
        movedFeet: outcome.movedFeet,
        destination: retreatDest,
        targetName,
        newDistance: newDist,
        opportunityAttacks: outcome.opportunityAttacks,
        aiReactionDecisions: outcome.aiDecisions,
        ...(bonusResult ? { bonusAction: bonusResult } : {}),
      },
    };
  }
}
