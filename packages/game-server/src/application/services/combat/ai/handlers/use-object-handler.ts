/**
 * UseObjectHandler — executes AI useObject decisions (currently: healing potions).
 */

import type { AiActionHandler, AiActionHandlerContext, AiActionHandlerDeps, AiHandlerResult } from "../ai-action-handler.js";
import { normalizeResources, getInventory } from "../../helpers/resource-utils.js";
import { useConsumableItem } from "../../../../../domain/entities/items/inventory.js";
import { POTION_HEALING_FORMULAS, lookupMagicItem } from "../../../../../domain/entities/items/magic-item-catalog.js";

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
    const healingPotion = inventory.find(item => {
      const formula = POTION_HEALING_FORMULAS[item.magicItemId ?? ""];
      if (formula) return item.quantity > 0;
      const itemDef = lookupMagicItem(item.name);
      return itemDef && POTION_HEALING_FORMULAS[itemDef.id] && item.quantity > 0;
    });

    if (!healingPotion) {
      return {
        action: decision.action,
        ok: false,
        summary: "No usable objects available. Use 'attack', 'move', or 'endTurn' instead.",
        data: { reason: "no_usable_objects" },
      };
    }

    const potionFormula = POTION_HEALING_FORMULAS[healingPotion.magicItemId ?? ""]
      ?? POTION_HEALING_FORMULAS[lookupMagicItem(healingPotion.name)?.id ?? ""];
    if (!potionFormula) {
      return {
        action: decision.action,
        ok: false,
        summary: "No usable healing potions available.",
        data: { reason: "no_usable_objects" },
      };
    }

    const { updatedInventory } = useConsumableItem(inventory, healingPotion.name);

    let healAmount = 0;
    let healMessage = "";
    if (diceRoller) {
      const diceResult = diceRoller.rollDie(potionFormula.diceSides, potionFormula.diceCount, potionFormula.modifier);
      healAmount = diceResult.total;
      healMessage = `${potionFormula.diceCount}d${potionFormula.diceSides}+${potionFormula.modifier} = ${healAmount}`;
    }

    const hpBefore = aiCombatant.hpCurrent;
    const hpMax = aiCombatant.hpMax;
    const hpAfter = Math.min(hpMax, hpBefore + healAmount);
    const actualHeal = hpAfter - hpBefore;

    const updatedResources = {
      ...resources,
      actionSpent: true,
      inventory: updatedInventory,
    };

    await combat.updateCombatantState(aiCombatant.id, {
      hpCurrent: hpAfter,
      resources: updatedResources as any,
    });

    const data: Record<string, unknown> = {
      item: healingPotion.name,
      healAmount: actualHeal,
      hpBefore,
      hpAfter,
      hpMax,
    };

    const bonusResult = await executeBonusAction(sessionId, encounterId, aiCombatant, decision, actorRef);
    if (bonusResult) data.bonusAction = bonusResult;

    const mainSummary = `Drinks ${healingPotion.name} and heals ${actualHeal} HP (${healMessage}). HP: ${hpAfter}/${hpMax}`;
    const fullSummary = bonusResult ? `${mainSummary}; then ${bonusResult.summary}` : mainSummary;

    return { action: decision.action, ok: true, summary: fullSummary, data };
  }
}
