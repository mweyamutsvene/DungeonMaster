/**
 * GrappleHandler — executes AI grapple decisions.
 */

import type { AiActionHandler, AiActionHandlerContext, AiActionHandlerDeps, AiHandlerResult } from "../ai-action-handler.js";

export class GrappleHandler implements AiActionHandler {
  handles(action: string): boolean {
    return action === "grapple";
  }

  async execute(ctx: AiActionHandlerContext, deps: AiActionHandlerDeps): Promise<AiHandlerResult> {
    const { sessionId, encounterId, aiCombatant, decision, allCombatants, actorRef } = ctx;
    const { actionService, executeBonusAction } = deps;

    if (!decision.target) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Grapple requires target",
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
    const result = await actionService.grapple(sessionId, {
      encounterId,
      actor: actorRef,
      target: targetRef,
      ...(seed !== undefined ? { seed } : {}),
    } as Parameters<typeof actionService.grapple>[1]);

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
      ...(seed !== undefined ? { seed } : {}),
    };

    const bonusResult = await executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
    if (bonusResult) data.bonusAction = bonusResult;

    if (result.result.success) {
      const mainSummary = `Grapple succeeded: ${decision.target} is grappled (attack ${result.result.attackTotal} vs AC ${result.result.targetAC}, save DC ${result.result.dc}, target rolled ${result.result.total})`;
      const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;
      return { action: decision.action, ok: true, summary: fullSummary, data };
    }

    const mainSummary = result.result.hit
      ? `Grapple failed against ${decision.target} (save DC ${result.result.dc}, target rolled ${result.result.total})`
      : `Grapple failed against ${decision.target} (Unarmed Strike missed: ${result.result.attackTotal} vs AC ${result.result.targetAC})`;
    const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;
    return { action: decision.action, ok: true, summary: fullSummary, data };
  }
}
