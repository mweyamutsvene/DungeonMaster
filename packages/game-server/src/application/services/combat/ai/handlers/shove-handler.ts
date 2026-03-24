/**
 * ShoveHandler — executes AI shove decisions.
 */

import type { AiActionHandler, AiActionHandlerContext, AiActionHandlerDeps, AiHandlerResult } from "../ai-action-handler.js";
import type { ActionService as CombatActionService } from "../../action-service.js";

export class ShoveHandler implements AiActionHandler {
  handles(action: string): boolean {
    return action === "shove";
  }

  async execute(ctx: AiActionHandlerContext, deps: AiActionHandlerDeps): Promise<AiHandlerResult> {
    const { sessionId, encounterId, aiCombatant, decision, allCombatants, actorRef } = ctx;
    const { actionService, executeBonusAction } = deps;

    if (!decision.target) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Shove requires target",
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

    const targetCombatant = await deps.findCombatantByName(decision.target, allCombatants);
    if (!targetCombatant) {
      return {
        action: decision.action,
        ok: false,
        summary: `Failed: Target ${decision.target} not found`,
        data: { reason: "target_not_found", target: decision.target },
      };
    }

    const targetRef = deps.toCombatantRef(targetCombatant);
    if (!targetRef) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Invalid target reference",
        data: { reason: "invalid_target_reference" },
      };
    }

    const seed = typeof (decision as Record<string, unknown>).seed === "number"
      ? (decision as Record<string, unknown>).seed as number
      : undefined;
    const result = await actionService.shove(sessionId, {
      encounterId,
      actor: actorRef,
      target: targetRef,
      shoveType: "push",
      ...(seed !== undefined ? { seed } : {}),
    } as Parameters<CombatActionService["shove"]>[1]);

    const data: Record<string, unknown> = {
      target: decision.target,
      success: result.result.success,
      attackRoll: result.result.attackRoll,
      attackTotal: result.result.attackTotal,
      targetAC: result.result.targetAC,
      hit: result.result.hit,
      dc: result.result.dc,
      saveRoll: result.result.saveRoll,
      total: result.result.total,
      abilityUsed: result.result.abilityUsed,
      ...(result.result.pushedTo ? { pushedTo: result.result.pushedTo } : {}),
      ...(seed !== undefined ? { seed } : {}),
    };

    const bonusResult = await executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
    if (bonusResult) data.bonusAction = bonusResult;

    if (result.result.success) {
      const mainSummary = result.result.pushedTo
        ? `Shove succeeded: pushed ${decision.target} to (${result.result.pushedTo.x}, ${result.result.pushedTo.y})`
        : `Shove succeeded against ${decision.target}`;
      const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;
      return { action: decision.action, ok: true, summary: fullSummary, data };
    }

    const mainSummary = result.result.hit
      ? `Shove failed against ${decision.target} (save DC ${result.result.dc}, target rolled ${result.result.total})`
      : `Shove failed against ${decision.target} (Unarmed Strike missed: ${result.result.attackTotal} vs AC ${result.result.targetAC})`;
    const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;
    return { action: decision.action, ok: true, summary: fullSummary, data };
  }
}
