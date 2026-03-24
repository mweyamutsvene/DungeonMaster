/**
 * UseObjectHandler — executes AI useObject decisions (potions and other consumables).
 * Supports any item with a `potionEffects` definition on its MagicItemDefinition.
 */

import { nanoid } from "nanoid";
import type { AiActionHandler, AiActionHandlerContext, AiActionHandlerDeps, AiHandlerResult } from "../ai-action-handler.js";
import { normalizeResources, getInventory, addActiveEffectsToResources } from "../../helpers/resource-utils.js";
import { useConsumableItem } from "../../../../../domain/entities/items/inventory.js";
import { lookupMagicItem } from "../../../../../domain/entities/items/magic-item-catalog.js";
import { createEffect } from "../../../../../domain/entities/combat/effects.js";
import {
  addCondition,
  removeCondition,
  normalizeConditions,
  type Condition,
} from "../../../../../domain/entities/combat/conditions.js";
import type { CharacterItemInstance } from "../../../../../domain/entities/items/magic-item.js";

/**
 * Find the best usable item in inventory — prefers healing when low on HP,
 * otherwise picks the first available potion.
 */
function findBestUsableItem(
  inventory: CharacterItemInstance[],
  hpPercent: number,
): CharacterItemInstance | undefined {
  const usable = inventory.filter(item => {
    if (item.quantity < 1) return false;
    const def = lookupMagicItem(item.name) ?? (item.magicItemId ? lookupMagicItem(item.name) : undefined);
    return def?.potionEffects !== undefined;
  });

  if (usable.length === 0) return undefined;

  // Low HP (<= 50%): prefer healing potions
  if (hpPercent <= 50) {
    const healingPotion = usable.find(item => {
      const def = lookupMagicItem(item.name);
      return def?.potionEffects?.healing !== undefined;
    });
    if (healingPotion) return healingPotion;
  }

  // Otherwise pick the first available potion
  return usable[0];
}

export class UseObjectHandler implements AiActionHandler {
  handles(action: string): boolean {
    return action === "useObject";
  }

  async execute(ctx: AiActionHandlerContext, deps: AiActionHandlerDeps): Promise<AiHandlerResult> {
    const { sessionId, encounterId, aiCombatant, decision, actorRef } = ctx;
    const { combat, diceRoller, executeBonusAction } = deps;

    if (!actorRef) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Invalid combatant reference",
        data: { reason: "invalid_combatant_reference" },
      };
    }

    const resources = normalizeResources(aiCombatant.resources);
    if (resources.actionSpent) {
      return {
        action: decision.action,
        ok: false,
        summary: "Failed: Action already spent this turn",
        data: { reason: "action_already_spent" },
      };
    }

    const inventory = getInventory(aiCombatant.resources);
    const hpPercent = aiCombatant.hpMax > 0 ? Math.round((aiCombatant.hpCurrent / aiCombatant.hpMax) * 100) : 0;
    const chosenItem = findBestUsableItem(inventory, hpPercent);

    if (!chosenItem) {
      return {
        action: decision.action,
        ok: false,
        summary: "No usable objects available. Use 'attack', 'move', or 'endTurn' instead.",
        data: { reason: "no_usable_objects" },
      };
    }

    const itemDef = lookupMagicItem(chosenItem.name);
    if (!itemDef?.potionEffects) {
      return {
        action: decision.action,
        ok: false,
        summary: "No usable potions available.",
        data: { reason: "no_usable_objects" },
      };
    }

    const { updatedInventory } = useConsumableItem(inventory, chosenItem.name);
    const potionEffects = itemDef.potionEffects;
    const messageParts: string[] = [];
    let updatedResources = { ...resources, actionSpent: true, inventory: updatedInventory };
    let newHpCurrent = aiCombatant.hpCurrent;

    // ── Apply healing ─────────────────────────────────────────────
    if (potionEffects.healing && diceRoller) {
      const formula = potionEffects.healing;
      const diceResult = diceRoller.rollDie(formula.diceSides, formula.diceCount, formula.modifier);
      const healAmount = diceResult.total;
      const hpBefore = aiCombatant.hpCurrent;
      const hpMax = aiCombatant.hpMax;
      newHpCurrent = Math.min(hpMax, hpBefore + healAmount);
      const actualHeal = newHpCurrent - hpBefore;
      messageParts.push(`heals ${actualHeal} HP (${formula.diceCount}d${formula.diceSides}+${formula.modifier} = ${healAmount}). HP: ${newHpCurrent}/${hpMax}`);
    }

    // ── Apply temp HP ──────────────────────────────────────────────
    if (potionEffects.tempHp && potionEffects.tempHp > 0) {
      const existingTempHp = typeof (updatedResources as any).tempHp === "number" ? (updatedResources as any).tempHp as number : 0;
      if (potionEffects.tempHp > existingTempHp) {
        (updatedResources as any).tempHp = potionEffects.tempHp;
      }
      messageParts.push(`gains ${potionEffects.tempHp} temporary HP`);
    }

    // ── Apply ActiveEffects ────────────────────────────────────────
    if (potionEffects.effects && potionEffects.effects.length > 0) {
      const newEffects = potionEffects.effects.map(template =>
        createEffect(
          nanoid(),
          template.type,
          template.target,
          template.duration,
          {
            value: template.value,
            diceValue: template.diceValue,
            ability: template.ability,
            damageType: template.damageType,
            roundsRemaining: template.roundsRemaining,
            source: template.source,
            description: template.description,
            conditionName: template.conditionName,
            triggerAt: template.triggerAt,
          },
        )
      );
      updatedResources = addActiveEffectsToResources(updatedResources, ...newEffects) as typeof updatedResources;
      const effectNames = [...new Set(potionEffects.effects.map(e => e.source ?? e.description ?? e.type))];
      messageParts.push(`gains: ${effectNames.join(", ")}`);
    }

    // ── Apply conditions ───────────────────────────────────────────
    let updatedConditions = normalizeConditions(aiCombatant.conditions as unknown[]);
    if (potionEffects.applyConditions && potionEffects.applyConditions.length > 0) {
      for (const cond of potionEffects.applyConditions) {
        updatedConditions = addCondition(updatedConditions, {
          condition: cond.condition as Condition,
          duration: cond.duration as any,
          ...(cond.roundsRemaining !== undefined ? { roundsRemaining: cond.roundsRemaining } : {}),
        });
      }
      messageParts.push(`gains condition(s): ${potionEffects.applyConditions.map(c => c.condition).join(", ")}`);
    }

    if (potionEffects.removeConditions && potionEffects.removeConditions.length > 0) {
      for (const condName of potionEffects.removeConditions) {
        updatedConditions = removeCondition(updatedConditions, condName as Condition);
      }
    }

    await combat.updateCombatantState(aiCombatant.id, {
      hpCurrent: newHpCurrent,
      resources: updatedResources as any,
      conditions: updatedConditions as any,
    });

    const mainSummary = `Uses ${chosenItem.name}. ${messageParts.join("; ")}`;
    const data: Record<string, unknown> = {
      item: chosenItem.name,
      hpBefore: aiCombatant.hpCurrent,
      hpAfter: newHpCurrent,
      hpMax: aiCombatant.hpMax,
    };

    const bonusResult = await executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
    if (bonusResult) data.bonusAction = bonusResult;

    const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;
    return { action: decision.action, ok: true, summary: fullSummary, data };
  }
}
