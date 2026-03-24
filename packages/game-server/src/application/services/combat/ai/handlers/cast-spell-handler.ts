/**
 * CastSpellHandler — executes AI castSpell decisions.
 * Handles Counterspell reaction detection and spell slot management.
 */

import type { AiActionHandler, AiActionHandlerContext, AiActionHandlerDeps, AiHandlerResult } from "../ai-action-handler.js";
import { spendAction } from "../../helpers/resource-utils.js";
import { findPreparedSpellInSheet, prepareSpellCast } from "../../helpers/spell-slot-manager.js";
import type { CombatantRef } from "../../helpers/combatant-ref.js";

export class CastSpellHandler implements AiActionHandler {
  handles(action: string): boolean {
    return action === "castSpell";
  }

  async execute(ctx: AiActionHandlerContext, deps: AiActionHandlerDeps): Promise<AiHandlerResult> {
    const { sessionId, encounterId, aiCombatant, decision, actorRef } = ctx;
    const { actionService, twoPhaseActions, combat, characters, aiLog: _aiLog, executeBonusAction } = deps;

    if (!actorRef) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Invalid combatant reference",
        data: { reason: "invalid_combatant_reference" },
      };
    }

    const spellNameRaw = (decision as Record<string, unknown>).spellName;
    const spellName = typeof spellNameRaw === "string" ? spellNameRaw.trim() : "";
    if (spellName.length === 0) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: castSpell requires spellName",
        data: { reason: "missing_spell_name" },
      };
    }

    const spellLevelRaw = (decision as Record<string, unknown>).spellLevel;
    const spellLevel = typeof spellLevelRaw === "number" ? spellLevelRaw : 1;

    const isCharacterCaster = aiCombatant.combatantType === "Character" && !!aiCombatant.characterId;

    let isConcentration = false;
    if (isCharacterCaster && characters) {
      try {
        const characterRecord = await characters.getById(aiCombatant.characterId!);
        if (characterRecord) {
          const spellDef = findPreparedSpellInSheet(characterRecord.sheet, spellName);
          if (spellDef) {
            isConcentration = spellDef.concentration ?? false;
          }
        }
      } catch { /* Non-fatal */ }
    }

    const initiateResult = await twoPhaseActions.initiateSpellCast(sessionId, {
      encounterId,
      actor: actorRef as CombatantRef,
      spellName,
      spellLevel,
    });

    console.log("[CastSpellHandler] initiateSpellCast result:", {
      status: initiateResult.status,
      pendingActionId: initiateResult.pendingActionId,
      counterspellOpportunities: initiateResult.counterspellOpportunities.length,
    });

    if (initiateResult.status === "awaiting_reactions" && initiateResult.pendingActionId) {
      console.log("[CastSpellHandler] Spell cast awaiting Counterspell reaction from player");

      if (isCharacterCaster) {
        await prepareSpellCast(
          aiCombatant.id,
          encounterId,
          spellName,
          spellLevel,
          isConcentration,
          combat,
        );
      }

      await combat.setPendingAction(encounterId, {
        id: initiateResult.pendingActionId,
        type: "reaction_pending",
        pendingActionId: initiateResult.pendingActionId,
        reactionType: "counterspell",
        spellName,
        spellLevel,
      });

      const freshCombatants = await combat.listCombatants(encounterId);
      const freshActor = freshCombatants.find((c) => c.id === aiCombatant.id);
      await combat.updateCombatantState(aiCombatant.id, {
        resources: spendAction((freshActor ?? aiCombatant).resources),
      });

      return {
        action: decision.action,
        ok: true,
        summary: `Casting ${spellName} - awaiting Counterspell reaction`,
        data: {
          awaitingPlayerInput: true,
          pendingActionId: initiateResult.pendingActionId,
          spellName,
          spellLevel,
        },
      };
    }

    if (isCharacterCaster) {
      await prepareSpellCast(
        aiCombatant.id,
        encounterId,
        spellName,
        spellLevel,
        isConcentration,
        combat,
      );
    }

    // TODO: [SpellDelivery] AI spell mechanical effects (damage, healing, saving throws,
    // buffs, zone effects) are NOT applied in the AI path. Full delivery requires the
    // interactive tabletop dice flow (SpellAttackDeliveryHandler returns requiresPlayerInput=true).
    // Tracked in plan-spell-path-unification.prompt.md.
    await actionService.castSpell(sessionId, { encounterId, actor: actorRef, spellName });

    const bonusResult = await executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
    const mainSummary = `Cast spell: ${spellName}`;
    const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;

    return {
      action: decision.action,
      ok: true,
      summary: fullSummary,
      data: { spellName, spellLevel, ...(bonusResult ? { bonusAction: bonusResult } : {}) },
    };
  }
}
