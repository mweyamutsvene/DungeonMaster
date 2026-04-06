/**
 * CastSpellHandler — executes AI castSpell decisions.
 * Handles Counterspell reaction detection, spell slot management,
 * and mechanical effect delivery (damage, healing, saves, buffs).
 */

import type { AiActionHandler, AiActionHandlerContext, AiActionHandlerDeps, AiHandlerResult } from "../ai-action-handler.js";
import { spendAction } from "../../helpers/resource-utils.js";
import { findPreparedSpellInSheet, prepareSpellCast } from "../../helpers/spell-slot-manager.js";
import type { CombatantRef } from "../../helpers/combatant-ref.js";
import { AiSpellDelivery, findSpellDefinition } from "./ai-spell-delivery.js";

export class CastSpellHandler implements AiActionHandler {
  handles(action: string): boolean {
    return action === "castSpell";
  }

  async execute(ctx: AiActionHandlerContext, deps: AiActionHandlerDeps): Promise<AiHandlerResult> {
    const { sessionId, encounterId, aiCombatant, decision, allCombatants, actorRef } = ctx;
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

    const castAtLevelRaw = (decision as Record<string, unknown>).castAtLevel;
    const castAtLevel = typeof castAtLevelRaw === "number" ? castAtLevelRaw : undefined;

    const isCharacterCaster = aiCombatant.combatantType === "Character" && !!aiCombatant.characterId;

    // ── Look up caster entity data + spell definition ──
    let casterSource: Record<string, unknown> = {};
    let isConcentration = false;

    if (isCharacterCaster && characters) {
      try {
        const characterRecord = await characters.getById(aiCombatant.characterId!);
        if (characterRecord) {
          casterSource = (characterRecord.sheet as Record<string, unknown>) ?? {};
          const spellDef = findPreparedSpellInSheet(characterRecord.sheet, spellName);
          if (spellDef) {
            isConcentration = spellDef.concentration ?? false;
          }
        }
      } catch { /* Non-fatal */ }
    } else if (aiCombatant.combatantType === "Monster" && aiCombatant.monsterId && deps.monsters) {
      try {
        const monsterRecord = await deps.monsters.getById(aiCombatant.monsterId);
        if (monsterRecord) {
          casterSource = (monsterRecord.statBlock as Record<string, unknown>) ?? {};
          const spellDef = findSpellDefinition(casterSource, spellName);
          if (spellDef) isConcentration = spellDef.concentration ?? false;
        }
      } catch { /* Non-fatal */ }
    } else if (aiCombatant.combatantType === "NPC" && aiCombatant.npcId && deps.npcs) {
      try {
        const npcRecord = await deps.npcs.getById(aiCombatant.npcId);
        if (npcRecord) {
          casterSource = (npcRecord.statBlock as Record<string, unknown>) ?? {};
          const spellDef = findSpellDefinition(casterSource, spellName);
          if (spellDef) isConcentration = spellDef.concentration ?? false;
        }
      } catch { /* Non-fatal */ }
    }

    // ── Counterspell reaction detection (two-phase) ──
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

      // Spend slot for ALL caster types (Character, Monster, NPC) — slot is consumed
      // even when counterspelled (D&D 5e 2024: slot is expended on casting, not on effect).
      await prepareSpellCast(
        aiCombatant.id,
        encounterId,
        spellName,
        spellLevel,
        isConcentration,
        combat,
        undefined,
        castAtLevel,
      );

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

    // ── Spell slot spending + concentration — applies to all caster types ──
    await prepareSpellCast(
      aiCombatant.id,
      encounterId,
      spellName,
      spellLevel,
      isConcentration,
      combat,
      undefined,
      castAtLevel,
    );

    // ── Spell mechanical effect delivery ──
    let deliverySummary: string | null = null;
    const spellDef = findSpellDefinition(casterSource, spellName);

    if (spellDef && deps.diceRoller && deps.monsters && deps.npcs) {
      try {
        const delivery = new AiSpellDelivery({
          combat,
          characters,
          monsters: deps.monsters,
          npcs: deps.npcs,
          diceRoller: deps.diceRoller,
        });

        // Resolve target combatant from decision.target
        const targetName = (decision as Record<string, unknown>).target as string | undefined;
        let targetCombatant = null;
        if (targetName) {
          targetCombatant = await deps.findCombatantByName(targetName, allCombatants);
        }

        const result = await delivery.deliver(
          sessionId,
          encounterId,
          aiCombatant,
          spellDef,
          targetCombatant,
          targetName,
          castAtLevel,
          casterSource,
        );

        if (result.applied) {
          deliverySummary = result.summary;
        }
      } catch (err) {
        console.error("[CastSpellHandler] Spell delivery error (non-fatal):", err);
      }
    }

    // ── Mark action spent ──
    await actionService.castSpell(sessionId, { encounterId, actor: actorRef, spellName });

    const bonusResult = await executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
    const mainSummary = deliverySummary
      ? `Cast spell: ${spellName} — ${deliverySummary}`
      : `Cast spell: ${spellName}`;
    const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;

    return {
      action: decision.action,
      ok: true,
      summary: fullSummary,
      data: { spellName, spellLevel, ...(deliverySummary ? { spellEffects: deliverySummary } : {}), ...(bonusResult ? { bonusAction: bonusResult } : {}) },
    };
  }
}
