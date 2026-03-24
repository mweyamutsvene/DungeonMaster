/**
 * SearchHandler — executes AI search decisions.
 */

import type { AiActionHandler, AiActionHandlerContext, AiActionHandlerDeps, AiHandlerResult } from "../ai-action-handler.js";

export class SearchHandler implements AiActionHandler {
  handles(action: string): boolean {
    return action === "search";
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

    const result = await actionService.search(sessionId, {
      encounterId,
      actor: actorRef,
    });

    const data: Record<string, unknown> = {
      found: result.result.found,
      roll: result.result.roll,
    };

    const bonusResult = await executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
    if (bonusResult) data.bonusAction = bonusResult;

    const mainSummary = result.result.found.length > 0
      ? `Search: found ${result.result.found.join(", ")} (perception roll ${result.result.roll})`
      : `Search: no hidden creatures found (perception roll ${result.result.roll})`;
    const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;

    return { action: decision.action, ok: true, summary: fullSummary, data };
  }
}
