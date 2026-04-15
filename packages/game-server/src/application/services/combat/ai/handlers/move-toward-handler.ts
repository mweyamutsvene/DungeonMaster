/**
 * MoveTowardHandler — executes AI moveToward decisions: A*-pathfind toward a named target.
 */

import type { AiActionHandler, AiActionHandlerContext, AiActionHandlerDeps, AiHandlerResult } from "../ai-action-handler.js";
import { normalizeConditions, hasCondition } from "../../../../../domain/entities/combat/conditions.js";
import { calculateDistance } from "../../../../../domain/rules/movement.js";
import { findPath, findAdjacentPosition } from "../../../../../domain/rules/pathfinding.js";
import { getEffectiveSpeed } from "../../helpers/resource-utils.js";
import { resolveAiMovement } from "../ai-movement-resolver.js";
import { getMapZones } from "../../../../../domain/rules/combat-map.js";
import { buildPathNarration } from "../../tabletop/path-narrator.js";
import type { CombatMap } from "../../../../../domain/rules/combat-map.js";

export class MoveTowardHandler implements AiActionHandler {
  handles(action: string): boolean {
    return action === "moveToward";
  }

  async execute(ctx: AiActionHandlerContext, deps: AiActionHandlerDeps): Promise<AiHandlerResult> {
    const { sessionId, encounterId, aiCombatant, decision, allCombatants, actorRef } = ctx;
    const { combat, combatantResolver, aiLog, executeBonusAction } = deps;

    if (!decision.target) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: moveToward requires a target name",
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

    const desiredRange = decision.desiredRange ?? 5;
    const currentDistance = calculateDistance(currentPos, targetPos);
    if (currentDistance <= desiredRange) {
      return {
        action: decision.action,
        ok: true,
        summary: `Already within ${desiredRange}ft of ${decision.target} (${Math.round(currentDistance)}ft away)`,
        data: { movedFeet: 0, alreadyInRange: true },
      };
    }

    const speed = getEffectiveSpeed(aiCombatant.resources);
    if (speed <= 0) {
      return {
        action: decision.action,
        ok: true,
        summary: `Cannot move (speed is 0)`,
        data: { movedFeet: 0, speedZero: true },
      };
    }
    const hasDashed = (resources.dashed as boolean) ?? false;
    let effectiveSpeed = hasDashed ? speed * 2 : speed;

    // Cap by already-spent movement (second+ move in the same turn)
    const movementRemainingValue = resources.movementRemaining;
    if (typeof movementRemainingValue === "number") {
      effectiveSpeed = Math.min(effectiveSpeed, movementRemainingValue as number);
    }
    if (effectiveSpeed <= 0) {
      return {
        action: decision.action,
        ok: true,
        summary: `No movement remaining this turn`,
        data: { movedFeet: 0, movementExhausted: true },
      };
    }

    const aiConditions = normalizeConditions(aiCombatant.conditions as unknown[]);
    const isProne = hasCondition(aiConditions, "Prone");
    if (isProne) {
      const standUpCost = Math.ceil(speed / 2);
      effectiveSpeed -= standUpCost;
      aiLog(`[MoveTowardHandler] Prone stand-up costs ${standUpCost}ft, effective speed: ${effectiveSpeed}ft`);
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
    } catch { /* No map available */ }

    let finalDestination: { x: number; y: number };
    let pathCells: { x: number; y: number }[] | undefined;
    let pathCostFeet: number | undefined;
    let pathNarrationHints: string[] | undefined;

    if (combatMap) {
      const dest = findAdjacentPosition(combatMap, targetPos, currentPos, desiredRange);
      if (!dest) {
        return {
          action: decision.action,
          ok: false,
          summary: `Failed: No reachable position within ${desiredRange}ft of ${decision.target}`,
          data: { reason: "no_reachable_position" },
        };
      }

      const occupiedPositions = allCombatants
        .filter((c) => c.id !== aiCombatant.id && c.id !== targetCombatant.id)
        .map((c) => (c.resources as Record<string, unknown>)?.position as { x: number; y: number })
        .filter((p): p is { x: number; y: number } => !!p && typeof p.x === "number" && typeof p.y === "number");

      const pathResult = findPath(combatMap, currentPos, dest, {
        maxCostFeet: effectiveSpeed,
        occupiedPositions,
        zones: getMapZones(combatMap),
      });

      if (pathResult.blocked && pathResult.path.length === 0) {
        return {
          action: decision.action,
          ok: false,
          summary: `Failed: Path to ${decision.target} is completely blocked`,
          data: { reason: "path_blocked" },
        };
      }

      finalDestination = pathResult.reachablePosition ?? dest;
      pathCells = pathResult.path;
      pathCostFeet = pathResult.totalCostFeet;
      pathNarrationHints = pathResult.narrationHints;
    } else {
      const dx = targetPos.x - currentPos.x;
      const dy = targetPos.y - currentPos.y;
      const dist = currentDistance - desiredRange;
      const moveDist = Math.min(dist, effectiveSpeed);
      const ratio = moveDist / currentDistance;
      finalDestination = {
        x: Math.round(currentPos.x + dx * ratio),
        y: Math.round(currentPos.y + dy * ratio),
      };
    }

    const targetName = await combatantResolver.getName(
      deps.toCombatantRef(targetCombatant) ?? actorRef,
      targetCombatant,
    );
    const actorName = await combatantResolver.getName(actorRef, aiCombatant);

    const outcome = await resolveAiMovement(deps.getMovementDeps(), {
      sessionId, encounterId,
      aiCombatant, actorRef, allCombatants,
      currentPos, finalDestination, effectiveSpeed, resources,
      pathCells, pathCostFeet, pathNarrationHints,
    });

    if (outcome.kind === "aborted_by_trigger") {
      return {
        action: decision.action,
        ok: false,
        summary: `${outcome.message} Knocked out before moving.`,
        data: { reason: "knocked_out_by_movement_trigger" },
      };
    }

    if (outcome.kind === "player_oa_pending") {
      return {
        action: decision.action,
        ok: true,
        summary: `Moved toward ${targetName} - awaiting ${outcome.playerOAsCount} player OA(s)`,
        data: {
          awaitingPlayerInput: true,
          playerOAsCount: outcome.playerOAsCount,
          pendingActionId: outcome.pendingActionId,
        },
      };
    }

    const bonusResult = await executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);

    if (outcome.kind === "no_reactions") {
      const pathNarration = buildPathNarration({
        actorName,
        targetName,
        pathCells,
        pathCostFeet: outcome.pathCostFeet,
        desiredRange,
        narrationHints: pathNarrationHints,
        partial: pathCostFeet != null && outcome.pathCostFeet < calculateDistance(currentPos, finalDestination),
        startPosition: currentPos,
        endPosition: finalDestination,
      });
      const fullSummary = bonusResult ? `${pathNarration} ${bonusResult.summary}` : pathNarration;
      return {
        action: decision.action,
        ok: true,
        summary: fullSummary,
        data: {
          movedFeet: outcome.pathCostFeet,
          destination: finalDestination,
          targetName,
          desiredRange,
          pathNarration,
          pathNarrationHints,
          opportunityAttacks: [],
          ...(bonusResult ? { bonusAction: bonusResult } : {}),
        },
      };
    }

    // outcome.kind === "completed"
    const usedCount = outcome.aiDecisions.filter((d: any) => d.used).length;
    const oaSummary = outcome.opportunityAttacks.length > 0
      ? ` Triggered ${usedCount}/${outcome.opportunityAttacks.length} OA(s).`
      : "";
    const pathNarration = buildPathNarration({
      actorName,
      targetName,
      pathCells,
      pathCostFeet: outcome.movedFeet,
      desiredRange,
      narrationHints: pathNarrationHints,
      partial: false,
      startPosition: currentPos,
      endPosition: finalDestination,
    });
    const mainSummary = `${pathNarration}${oaSummary}`;
    const fullSummary = bonusResult ? `${mainSummary} ${bonusResult.summary}` : mainSummary;

    return {
      action: decision.action,
      ok: true,
      summary: fullSummary,
      data: {
        movedFeet: outcome.movedFeet,
        destination: finalDestination,
        targetName,
        desiredRange,
        pathNarration,
        pathNarrationHints,
        opportunityAttacks: outcome.opportunityAttacks,
        aiReactionDecisions: outcome.aiDecisions,
        ...(bonusResult ? { bonusAction: bonusResult } : {}),
      },
    };
  }
}
