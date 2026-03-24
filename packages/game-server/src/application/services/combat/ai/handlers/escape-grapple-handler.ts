/**
 * EscapeGrappleHandler — executes AI escapeGrapple decisions.
 */

import type { AiActionHandler, AiActionHandlerContext, AiActionHandlerDeps, AiHandlerResult } from "../ai-action-handler.js";

export class EscapeGrappleHandler implements AiActionHandler {
  handles(action: string): boolean {
    return action === "escapeGrapple";
  }

  async execute(ctx: AiActionHandlerContext, deps: AiActionHandlerDeps): Promise<AiHandlerResult> {
    const { sessionId, encounterId, aiCombatant, decision, actorRef } = ctx;
    const { actionService, combat, executeBonusAction } = deps;

    if (!actorRef) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Invalid combatant reference",
        data: { reason: "invalid_combatant_reference" },
      };
    }

    let seed: number;
    if (typeof (decision as Record<string, unknown>).seed === "number") {
      seed = (decision as Record<string, unknown>).seed as number;
    } else {
      const encounter = await combat.getEncounterById(encounterId);
      seed = (encounter?.round ?? 1) * 1000 + (encounter?.turn ?? 0) * 10 + 2;
    }

    const result = await actionService.escapeGrapple(sessionId, {
      encounterId,
      actor: actorRef,
      seed,
    });

    const data: Record<string, unknown> = {
      success: result.result.success,
      dc: result.result.dc,
      saveRoll: result.result.saveRoll,
      total: result.result.total,
      abilityUsed: result.result.abilityUsed,
      seed,
    };

    const bonusResult = await executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
    if (bonusResult) data.bonusAction = bonusResult;

    if (result.result.success) {
      const mainSummary = `Escape Grapple succeeded (DC ${result.result.dc}, rolled ${result.result.total})`;
      const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;
      return { action: decision.action, ok: true, summary: fullSummary, data };
    }

    const mainSummary = `Escape Grapple failed (DC ${result.result.dc}, rolled ${result.result.total})`;
    const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;
    return { action: decision.action, ok: true, summary: fullSummary, data };
  }
}
