/**
 * EndTurnHandler — executes AI endTurn decisions.
 */

import type { AiActionHandler, AiActionHandlerContext, AiActionHandlerDeps, AiHandlerResult } from "../ai-action-handler.js";

export class EndTurnHandler implements AiActionHandler {
  handles(action: string): boolean {
    return action === "endTurn";
  }

  async execute(ctx: AiActionHandlerContext, deps: AiActionHandlerDeps): Promise<AiHandlerResult> {
    const { sessionId, encounterId, aiCombatant, decision, actorRef } = ctx;
    const { executeBonusAction } = deps;

    const bonusResult = await executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
    const summary = bonusResult ? `Ended turn (bonus action: ${bonusResult.summary})` : "Ended turn";
    return {
      action: decision.action,
      ok: true,
      summary,
      data: bonusResult ? { bonusAction: bonusResult } : undefined,
    };
  }
}
