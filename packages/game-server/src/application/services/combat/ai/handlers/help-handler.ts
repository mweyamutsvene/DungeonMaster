/**
 * HelpHandler — executes AI help decisions.
 */

import type { AiActionHandler, AiActionHandlerContext, AiActionHandlerDeps, AiHandlerResult } from "../ai-action-handler.js";

export class HelpHandler implements AiActionHandler {
  handles(action: string): boolean {
    return action === "help";
  }

  async execute(ctx: AiActionHandlerContext, deps: AiActionHandlerDeps): Promise<AiHandlerResult> {
    const { sessionId, encounterId, aiCombatant, decision, allCombatants, actorRef } = ctx;
    const { actionService, executeBonusAction } = deps;

    if (!actorRef) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Invalid combatant reference",
        data: { reason: "invalid_combatant_reference" },
      };
    }

    if (!decision.target) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Help requires a target",
        data: { reason: "missing_target" },
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

    await actionService.help(sessionId, { encounterId, actor: actorRef, target: targetRef });

    const bonusResult = await executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
    const mainSummary = `Helped ${decision.target} (next check/attack gains advantage, depending on context)`;
    const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;

    return {
      action: decision.action,
      ok: true,
      summary: fullSummary,
      data: { target: decision.target, ...(bonusResult ? { bonusAction: bonusResult } : {}) },
    };
  }
}
