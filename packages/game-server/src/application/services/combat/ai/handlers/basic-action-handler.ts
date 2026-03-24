/**
 * BasicActionHandler — handles disengage, dash, and dodge AI decisions.
 */

import type { AiActionHandler, AiActionHandlerContext, AiActionHandlerDeps, AiHandlerResult } from "../ai-action-handler.js";

export class BasicActionHandler implements AiActionHandler {
  handles(action: string): boolean {
    return action === "disengage" || action === "dash" || action === "dodge";
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

    let mainSummary = "";
    if (decision.action === "disengage") {
      await actionService.disengage(sessionId, { encounterId, actor: actorRef });
      mainSummary = "Disengaged (no opportunity attacks while moving this turn)";
    } else if (decision.action === "dash") {
      await actionService.dash(sessionId, { encounterId, actor: actorRef });
      mainSummary = "Dashed (movement speed doubled for this turn)";
    } else {
      await actionService.dodge(sessionId, { encounterId, actor: actorRef });
      mainSummary = "Dodged (enemies have disadvantage on attacks until next turn)";
    }

    const bonusResult = await executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
    const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;

    return {
      action: decision.action,
      ok: true,
      summary: fullSummary,
      data: bonusResult ? { bonusAction: bonusResult } : undefined,
    };
  }
}
