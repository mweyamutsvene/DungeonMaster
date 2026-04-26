/**
 * UseFeatureHandler — executes AI useFeature decisions.
 * Delegates to the AbilityRegistry to execute class features like
 * Turn Undead, Lay on Hands, etc. as primary actions.
 */

import type { AiActionHandler, AiActionHandlerContext, AiActionHandlerDeps, AiHandlerResult } from "../ai-action-handler.js";
import { spendAction } from "../../helpers/resource-utils.js";
import { getNpcMechanicsSource } from "../../helpers/class-backed-actor.js";

export class UseFeatureHandler implements AiActionHandler {
  handles(action: string): boolean {
    return action === "useFeature";
  }

  async execute(ctx: AiActionHandlerContext, deps: AiActionHandlerDeps): Promise<AiHandlerResult> {
    const { sessionId, encounterId, aiCombatant, decision, allCombatants, actorRef } = ctx;
    const { abilityRegistry, combat, characters, monsters, npcs, aiLog, executeBonusAction } = deps;

    if (!actorRef) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Invalid combatant reference",
        data: { reason: "invalid_combatant_reference" },
      };
    }

    const featureId = (decision as Record<string, unknown>).featureId;
    if (typeof featureId !== "string" || featureId.trim().length === 0) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: useFeature requires featureId",
        data: { reason: "missing_feature_id" },
      };
    }

    const trimmedId = featureId.trim();

    if (!abilityRegistry.hasExecutor(trimmedId)) {
      aiLog(`[UseFeatureHandler] No executor found for featureId: ${trimmedId}`);
      return {
        action: decision.action,
        ok: false,
        summary: `Feature "${trimmedId}" is not recognized`,
        data: { reason: "unrecognized_feature", featureId: trimmedId },
      };
    }

    // ── Resolve entity data for params (sheet, resources, class info) ──
    const actorEntityId = actorRef.type === "Monster" ? actorRef.monsterId!
      : actorRef.type === "Character" ? actorRef.characterId!
      : actorRef.npcId!;

    let sheet: Record<string, unknown> | undefined;
    if (aiCombatant.combatantType === "Character" && aiCombatant.characterId && characters) {
      try {
        const characterRecord = await characters.getById(aiCombatant.characterId);
        if (characterRecord) {
          sheet = (characterRecord.sheet as Record<string, unknown>) ?? undefined;
        }
      } catch { /* Non-fatal */ }
    } else if (aiCombatant.combatantType === "Monster" && aiCombatant.monsterId && monsters) {
      try {
        const monsterRecord = await monsters.getById(aiCombatant.monsterId);
        if (monsterRecord) {
          sheet = (monsterRecord.statBlock as Record<string, unknown>) ?? undefined;
        }
      } catch { /* Non-fatal */ }
    } else if (aiCombatant.combatantType === "NPC" && aiCombatant.npcId && npcs) {
      try {
        const npcRecord = await npcs.getById(aiCombatant.npcId);
        if (npcRecord) {
          sheet = getNpcMechanicsSource(npcRecord);
        }
      } catch { /* Non-fatal */ }
    }

    // ── Resolve target if specified ──
    let targetRef: Record<string, unknown> | undefined;
    if (decision.target) {
      const targetCombatant = await deps.findCombatantByName(decision.target, allCombatants);
      if (targetCombatant) {
        targetRef = deps.toCombatantRef(targetCombatant) as Record<string, unknown> | undefined;
      }
    }

    // ── Execute via AbilityRegistry ──
    try {
      const result = await abilityRegistry.execute({
        sessionId,
        encounterId,
        actor: {
          getId: () => actorEntityId,
          getName: () => (aiCombatant as Record<string, unknown>).name as string ?? "Unknown",
          getCurrentHP: () => aiCombatant.hpCurrent ?? 0,
          getMaxHP: () => aiCombatant.hpMax ?? 0,
          getSpeed: () => 30,
          modifyHP: () => ({ actualChange: 0 }),
        },
        combat: {
          hasUsedAction: () => false,
          getRound: () => 0,
          getTurnIndex: () => 0,
          addEffect: () => {},
          getPosition: () => undefined,
          setPosition: () => {},
        },
        abilityId: trimmedId,
        params: {
          actor: actorRef,
          sheet,
          resources: aiCombatant.resources,
          target: targetRef,
          targetName: decision.target,
        },
        services: {
          attack: async (params: any) =>
            deps.actionService.attack(sessionId, params),
          disengage: async (params: any) =>
            deps.actionService.disengage(sessionId, { ...params, skipActionCheck: true }),
          dash: async (params: any) =>
            deps.actionService.dash(sessionId, { ...params, skipActionCheck: true }),
          dodge: async (params: any) =>
            deps.actionService.dodge(sessionId, { ...params, skipActionCheck: true }),
          hide: async (params: any) =>
            deps.actionService.hide(sessionId, { ...params, isBonusAction: true, skipActionCheck: true }),
        },
      });

      if (!result.success) {
        aiLog(`[UseFeatureHandler] Ability execution failed: ${result.summary}`);
        return {
          action: decision.action,
          ok: false,
          summary: result.summary,
          data: { reason: result.error ?? "ability_failed", featureId: trimmedId },
        };
      }

      // ── Handle resource spending from executor result ──
      if (result.data?.spendResource) {
        const spendResource = result.data.spendResource as { poolName: string; amount: number };
        const { spendResourceFromPool } = await import("../../helpers/resource-utils.js");
        const freshCombatants = await combat.listCombatants(encounterId);
        const freshCombatant = freshCombatants.find((c) => c.id === aiCombatant.id);
        const freshResources = freshCombatant?.resources ?? aiCombatant.resources;
        const updatedResources = spendResourceFromPool(freshResources, spendResource.poolName, spendResource.amount);
        await combat.updateCombatantState(aiCombatant.id, { resources: updatedResources });
      }

      // ── Handle HP updates from executor result (e.g., Lay on Hands) ──
      if (result.data?.hpUpdate) {
        const hpUpdate = result.data.hpUpdate as Record<string, unknown>;
        await combat.updateCombatantState(aiCombatant.id, hpUpdate);
      }

      // ── Handle updatedResources from executor result (e.g., Turn Undead sets actionSpent) ──
      if (result.data?.updatedResources) {
        await combat.updateCombatantState(aiCombatant.id, {
          resources: result.data.updatedResources,
        });
      }

      // ── Mark action spent if executor didn't already ──
      if (!result.data?.updatedResources) {
        const freshCombatants2 = await combat.listCombatants(encounterId);
        const freshActor = freshCombatants2.find((c) => c.id === aiCombatant.id);
        await combat.updateCombatantState(aiCombatant.id, {
          resources: spendAction((freshActor ?? aiCombatant).resources),
        });
      }

      // ── Bonus action ──
      const bonusResult = await executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
      const mainSummary = `Used ${result.data?.abilityName ?? trimmedId}: ${result.summary}`;
      const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;

      return {
        action: decision.action,
        ok: true,
        summary: fullSummary,
        data: {
          featureId: trimmedId,
          ...(result.data ?? {}),
          ...(bonusResult ? { bonusAction: bonusResult } : {}),
        },
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      aiLog(`[UseFeatureHandler] Exception during ability execution: ${message}`);
      return {
        action: decision.action,
        ok: false,
        summary: `Failed to use feature "${trimmedId}": ${message}`,
        data: { reason: "exception", featureId: trimmedId, message },
      };
    }
  }
}
