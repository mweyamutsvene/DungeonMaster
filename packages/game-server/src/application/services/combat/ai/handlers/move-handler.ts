/**
 * MoveHandler — executes AI move decisions to explicit coordinates.
 */

import type { AiActionHandler, AiActionHandlerContext, AiActionHandlerDeps, AiHandlerResult } from "../ai-action-handler.js";
import { normalizeConditions, hasCondition } from "../../../../../domain/entities/combat/conditions.js";
import { calculateDistance } from "../../../../../domain/rules/movement.js";
import { getEffectiveSpeed } from "../../helpers/resource-utils.js";
import { generateLinearPath, resolveAiMovement } from "../ai-movement-resolver.js";

export class MoveHandler implements AiActionHandler {
  handles(action: string): boolean {
    return action === "move";
  }

  async execute(ctx: AiActionHandlerContext, deps: AiActionHandlerDeps): Promise<AiHandlerResult> {
    const { sessionId, encounterId, aiCombatant, decision, allCombatants, actorRef } = ctx;
    const { aiLog, executeBonusAction } = deps;

    if (!decision.destination) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Move requires destination",
        data: { reason: "missing_destination" },
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
    const speed = getEffectiveSpeed(aiCombatant.resources);
    const hasDashed = (resources.dashed as boolean) ?? false;
    let effectiveSpeed = hasDashed ? speed * 2 : speed;

    // Account for Prone stand-up cost
    const aiConditions = normalizeConditions(aiCombatant.conditions as unknown[]);
    const isProne = hasCondition(aiConditions, "Prone");
    if (isProne) {
      const standUpCost = Math.ceil(speed / 2);
      effectiveSpeed -= standUpCost;
      aiLog(`[MoveHandler] Prone stand-up costs ${standUpCost}ft, effective speed: ${effectiveSpeed}ft`);
      if (effectiveSpeed <= 0) {
        return {
          action: decision.action,
          ok: false,
          summary: `Failed: Standing from Prone costs ${standUpCost}ft, no movement remaining`,
          data: { reason: "prone_no_movement" },
        };
      }
    }

    // Clamp destination to effective speed
    let finalDestination = decision.destination;
    if (currentPos) {
      const requestedDistance = calculateDistance(currentPos, decision.destination);
      if (requestedDistance > effectiveSpeed) {
        const ratio = (effectiveSpeed * 0.99) / requestedDistance;
        const dx = decision.destination.x - currentPos.x;
        const dy = decision.destination.y - currentPos.y;
        finalDestination = {
          x: Math.round(currentPos.x + dx * ratio),
          y: Math.round(currentPos.y + dy * ratio),
        };
        const clampedDist = calculateDistance(currentPos, finalDestination);
        aiLog(`[MoveHandler] Clamped move from ${requestedDistance.toFixed(1)}ft to ${clampedDist.toFixed(1)}ft (max ${effectiveSpeed}ft): (${decision.destination.x}, ${decision.destination.y}) -> (${finalDestination.x}, ${finalDestination.y})`);
      }
    }

    const outcome = await resolveAiMovement(deps.getMovementDeps(), {
      sessionId,
      encounterId,
      aiCombatant,
      actorRef,
      allCombatants,
      currentPos,
      finalDestination,
      effectiveSpeed,
      resources,
      zoneDamagePath: currentPos ? generateLinearPath(currentPos, finalDestination) : undefined,
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
        summary: `Moved toward (${finalDestination.x}, ${finalDestination.y}) - awaiting ${outcome.playerOAsCount} player OA(s)`,
        data: {
          awaitingPlayerInput: true,
          playerOAsCount: outcome.playerOAsCount,
          pendingActionId: outcome.pendingActionId,
        },
      };
    }

    const bonusResult = await executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);

    if (outcome.kind === "no_reactions") {
      const mainSummary = `Moved ${outcome.movedFeet}ft to (${finalDestination.x}, ${finalDestination.y})`;
      const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;
      return {
        action: decision.action,
        ok: true,
        summary: fullSummary,
        data: {
          movedFeet: outcome.movedFeet,
          destination: finalDestination,
          opportunityAttacks: [],
          ...(bonusResult ? { bonusAction: bonusResult } : {}),
        },
      };
    }

    // outcome.kind === "completed"
    const usedCount = outcome.aiDecisions.filter((d: any) => d.used).length;
    const playerPromptCount = outcome.aiDecisions.filter((d: any) => d.reason === "player_prompted").length;
    const oaSummary = outcome.opportunityAttacks.length > 0
      ? `, triggered ${usedCount}/${outcome.opportunityAttacks.length} OA(s)` +
        (playerPromptCount > 0 ? ` (${playerPromptCount} awaiting player input)` : "")
      : "";
    const mainSummary = `Moved ${outcome.movedFeet}ft to (${finalDestination.x}, ${finalDestination.y})${oaSummary}`;
    const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;

    return {
      action: decision.action,
      ok: true,
      summary: fullSummary,
      data: {
        movedFeet: outcome.movedFeet,
        destination: decision.destination,
        opportunityAttacks: outcome.opportunityAttacks,
        aiReactionDecisions: outcome.aiDecisions,
        ...(bonusResult ? { bonusAction: bonusResult } : {}),
      },
    };
  }
}
