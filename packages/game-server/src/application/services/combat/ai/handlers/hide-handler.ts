/**
 * HideHandler — executes AI hide decisions.
 */

import type { AiActionHandler, AiActionHandlerContext, AiActionHandlerDeps, AiHandlerResult } from "../ai-action-handler.js";

export class HideHandler implements AiActionHandler {
  handles(action: string): boolean {
    return action === "hide";
  }

  async execute(ctx: AiActionHandlerContext, deps: AiActionHandlerDeps): Promise<AiHandlerResult> {
    const { sessionId, encounterId, aiCombatant, decision, actorRef } = ctx;
    const { actionService, executeBonusAction } = deps;

    if (!actorRef) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Invalid combatant reference",
        data: { reason: "invalid_combatant_reference" },
      };
    }

    const result = await actionService.hide(sessionId, {
      encounterId,
      actor: actorRef,
      hasCover: true, // AI assumes cover is available
    });

    const data: Record<string, unknown> = {
      success: result.result.success,
      stealthRoll: result.result.stealthRoll,
    };

    const bonusResult = await executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
    if (bonusResult) data.bonusAction = bonusResult;

    const mainSummary = result.result.success
      ? `Hide succeeded: stealth roll ${result.result.stealthRoll}`
      : `Hide failed: stealth roll ${result.result.stealthRoll}${result.result.reason ? ` (${result.result.reason})` : ""}`;
    const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;

    return { action: decision.action, ok: true, summary: fullSummary, data };
  }
}
