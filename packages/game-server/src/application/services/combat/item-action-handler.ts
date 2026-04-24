/**
 * ItemActionHandler — give / administer between combatants.
 *
 * Covers the two NEW item-use operations from the inventory-G2 plan (D6):
 *
 *   - `giveItem(actor, target, item)` — transfer 1× item between two character
 *     sheets atomically. No activation on either side. Consumes the actor's
 *     free object interaction (default) or falls through to Utilize action
 *     per the item's `actionCosts.give`. Requires the target to be a live
 *     character combatant (transfer between party members).
 *
 *   - `administerItem(actor, target, item)` — force-feed / apply item effects
 *     to target. Consumes 1× item from actor's inventory, applies the item's
 *     `potionEffects` to the target (healing, etc.), consumes the actor's
 *     action-economy slot per `actionCosts.administer`. Works on unconscious
 *     creatures (that's the point — feed a goodberry to a downed ally). If
 *     healing brings target above 0 HP, the Unconscious condition is removed
 *     per RAW "you fall unconscious at 0 HP".
 *
 * `useItem` (self-consume) is handled by `InteractionHandlers.handleUseItemAction`.
 * A future commit may extract its logic here so all three methods share the
 * same core effect-application pipeline. For now, the operations are disjoint.
 */

import { nanoid } from "nanoid";

import type { ICombatRepository } from "../../repositories/combat-repository.js";
import type { ICharacterRepository } from "../../repositories/character-repository.js";
import type { IEventRepository } from "../../repositories/event-repository.js";
import type { DiceRoller } from "../../../domain/rules/dice-roller.js";
import type { CombatantStateRecord } from "../../types.js";
import { NotFoundError, ValidationError } from "../../errors.js";
import {
  normalizeResources,
  patchResources,
  hasBonusActionAvailable,
  useBonusAction,
  hasFreeObjectInteractionAvailable,
  useFreeObjectInteraction,
  hasSpentAction,
  spendAction,
} from "./helpers/resource-utils.js";
import { findInventoryItem, removeInventoryItem } from "../../../domain/entities/items/inventory.js";
import type { CharacterItemInstance } from "../../../domain/entities/items/magic-item.js";
import { lookupMagicItem } from "../../../domain/entities/items/magic-item-catalog.js";
import type { ItemActionCosts, MagicItemDefinition } from "../../../domain/entities/items/magic-item.js";
import type { Condition } from "../../../domain/entities/combat/conditions.js";
import { InventoryService } from "../entities/inventory-service.js";

export interface ItemActionHandlerDeps {
  readonly combat: ICombatRepository;
  readonly characters: ICharacterRepository;
  readonly inventoryService: InventoryService;
  readonly events?: IEventRepository;
  readonly diceRoller?: DiceRoller;
}

export interface ItemActionResult {
  readonly message: string;
  readonly healingApplied?: number;
  readonly inventoryEvent?: "give" | "administer";
}

interface GiveItemInput {
  readonly sessionId: string;
  readonly encounterId: string;
  readonly actorCombatantId: string;
  readonly targetCombatantId: string;
  readonly itemName: string;
}

interface AdministerItemInput extends GiveItemInput {}

// ---------------------------------------------------------------------------

function getInventory(resources: unknown): CharacterItemInstance[] {
  if (typeof resources !== "object" || resources === null) return [];
  const inv = (resources as { inventory?: unknown }).inventory;
  return Array.isArray(inv) ? (inv as CharacterItemInstance[]) : [];
}

function requireCombatantCharacterId(c: CombatantStateRecord, label: string): string {
  if (c.combatantType !== "Character" || !c.characterId) {
    throw new ValidationError(
      `${label} must be a party character (transfer between characters only — got combatantType=${c.combatantType}).`,
    );
  }
  return c.characterId;
}

function removeConditionByName(conditions: unknown, name: Condition): unknown[] {
  if (!Array.isArray(conditions)) return [];
  const lower = name.toLowerCase();
  return conditions.filter((c) => {
    if (typeof c === "string") return c.toLowerCase() !== lower;
    if (typeof c === "object" && c && "condition" in c) {
      return String((c as { condition: string }).condition).toLowerCase() !== lower;
    }
    return true;
  });
}

function hasCondition(conditions: unknown, name: Condition): boolean {
  if (!Array.isArray(conditions)) return false;
  const lower = name.toLowerCase();
  return conditions.some((c) => {
    if (typeof c === "string") return c.toLowerCase() === lower;
    if (typeof c === "object" && c && "condition" in c) {
      return String((c as { condition: string }).condition).toLowerCase() === lower;
    }
    return false;
  });
}

// ---------------------------------------------------------------------------

export class ItemActionHandler {
  constructor(private readonly deps: ItemActionHandlerDeps) {}

  /**
   * Transfer one item from actor to target (characters only). No activation
   * on either side. Used by the "give X to Y" / "hand X to Y" text verb.
   */
  async giveItem(input: GiveItemInput): Promise<ItemActionResult> {
    const combatants = await this.deps.combat.listCombatants(input.encounterId);
    const actor = combatants.find((c) => c.id === input.actorCombatantId);
    const target = combatants.find((c) => c.id === input.targetCombatantId);
    if (!actor) throw new NotFoundError(`Actor combatant not found: ${input.actorCombatantId}`);
    if (!target) throw new NotFoundError(`Target combatant not found: ${input.targetCombatantId}`);

    // Transfers require both sides to be characters — InventoryService.transferItem
    // operates on SessionCharacter sheets. Monster/NPC inventory would need a
    // separate plumbing path (future commit).
    const actorCharId = requireCombatantCharacterId(actor, "Actor");
    const targetCharId = requireCombatantCharacterId(target, "Target");

    // Resolve item definition to determine actionCosts.give. Default =
    // 'free-object-interaction' (free-obj-int once per turn, degrades to
    // Utilize action when already spent).
    const inventory = getInventory(actor.resources);
    const sourceItem = findInventoryItem(inventory, input.itemName);
    if (!sourceItem) throw new ValidationError(`Actor does not have "${input.itemName}"`);
    const itemDef = lookupMagicItem(sourceItem.name) ?? lookupMagicItem(input.itemName);
    const cost = this.resolveGiveCost(itemDef?.actionCosts);

    // Validate and consume action-economy BEFORE the transfer so a rejected
    // transfer doesn't silently burn resources.
    const actorResources = this.consumeGiveCost(actor, cost);

    // Perform the atomic cross-sheet transfer.
    const transfer = await this.deps.inventoryService.transferItem(
      input.sessionId,
      actorCharId,
      targetCharId,
      input.itemName,
      1,
    );

    // Mirror the transferred state on both live combatants. InventoryService
    // only writes sheets; we wire the combat side so mid-combat item use by
    // either party works without re-hydrating.
    await this.deps.combat.updateCombatantState(actor.id, {
      resources: patchResources(actorResources, { inventory: transfer.fromInventory }),
    });
    await this.deps.combat.updateCombatantState(target.id, {
      resources: patchResources(normalizeResources(target.resources ?? {}), {
        inventory: transfer.toInventory,
      }),
    });

    return {
      message: `${actor.characterId ?? actor.id} hands ${input.itemName} to ${target.characterId ?? target.monsterId ?? target.npcId ?? target.id}.`,
      inventoryEvent: "give",
    };
  }

  /**
   * Force-feed / apply an item's effects to a target. Consumes 1× item from
   * actor's inventory, applies potionEffects to the target, consumes actor
   * action-economy per `actionCosts.administer`. Works on unconscious targets.
   */
  async administerItem(input: AdministerItemInput): Promise<ItemActionResult> {
    const combatants = await this.deps.combat.listCombatants(input.encounterId);
    const actor = combatants.find((c) => c.id === input.actorCombatantId);
    const target = combatants.find((c) => c.id === input.targetCombatantId);
    if (!actor) throw new NotFoundError(`Actor combatant not found: ${input.actorCombatantId}`);
    if (!target) throw new NotFoundError(`Target combatant not found: ${input.targetCombatantId}`);

    // Resolve item + cost. Default potion administer cost per 2024 RAW =
    // 'utilize'; catalog entries (e.g. Goodberry) override to 'bonus'.
    const inventory = getInventory(actor.resources);
    const sourceItem = findInventoryItem(inventory, input.itemName);
    if (!sourceItem) throw new ValidationError(`Actor does not have "${input.itemName}"`);
    const itemDef = lookupMagicItem(sourceItem.name) ?? lookupMagicItem(input.itemName);
    if (!itemDef?.potionEffects) {
      throw new ValidationError(
        `"${input.itemName}" has no potionEffects — cannot administer. Only consumable items are administerable.`,
      );
    }
    const cost = this.resolveAdministerCost(itemDef.actionCosts);

    // Validate + consume economy BEFORE effect application.
    const actorResources = this.consumeAdministerCost(actor, cost);

    // Decrement item on actor's combatant + sheet.
    const updatedActorInventory = removeInventoryItem(inventory, input.itemName, 1);
    await this.deps.combat.updateCombatantState(actor.id, {
      resources: patchResources(actorResources, { inventory: updatedActorInventory }),
    });
    const actorCharId = actor.combatantType === "Character" ? actor.characterId : null;
    if (actorCharId) {
      const actorChar = await this.deps.characters.getById(actorCharId);
      if (actorChar) {
        const sheetInv = getInventory((actorChar.sheet as { inventory?: unknown })?.inventory === undefined
          ? actorChar.sheet
          : (actorChar.sheet as Record<string, unknown>));
        const sheetUpdated = (() => {
          try {
            return removeInventoryItem(sheetInv, input.itemName, 1);
          } catch {
            return sheetInv; // already depleted on sheet — safe no-op
          }
        })();
        await this.deps.characters.updateSheet(actorChar.id, {
          ...(actorChar.sheet as Record<string, unknown>),
          inventory: sheetUpdated,
        } as unknown as never);
      }
    }

    // Apply item effects to the TARGET. For commit 4 we support flat + dice
    // healing (covers Goodberry, Potion of Healing, Heroism tempHp-elsewhere).
    // Damage potions, ActiveEffects, applyConditions on target are out of
    // scope here; handleUseItemAction still owns those paths for self-use.
    const healing = itemDef.potionEffects.healing;
    let healingApplied = 0;
    let hpAfter = target.hpCurrent;
    if (healing) {
      const isFlatHeal = healing.diceCount === 0 || healing.diceSides === 0;
      let healAmount: number;
      if (isFlatHeal) {
        healAmount = healing.modifier ?? 0;
      } else if (this.deps.diceRoller) {
        healAmount = this.deps.diceRoller.rollDie(healing.diceSides, healing.diceCount, healing.modifier ?? 0).total;
      } else {
        throw new ValidationError("Dice roller not configured");
      }
      const hpBefore = target.hpCurrent;
      const hpMax = target.hpMax;
      hpAfter = Math.min(hpMax, hpBefore + healAmount);
      healingApplied = hpAfter - hpBefore;
    }

    // Remove Unconscious when healing lifts target above 0 HP (2024 RAW:
    // "you fall unconscious at 0 HP" — its inverse applies on heal).
    let updatedConditions: unknown[] | undefined;
    if (hpAfter > 0 && hasCondition(target.conditions, "Unconscious" as Condition)) {
      updatedConditions = removeConditionByName(target.conditions, "Unconscious" as Condition);
    }

    await this.deps.combat.updateCombatantState(target.id, {
      hpCurrent: hpAfter,
      ...(updatedConditions ? { conditions: updatedConditions as never } : {}),
    });

    if (this.deps.events) {
      await this.deps.events.append(input.sessionId, {
        id: nanoid(),
        type: "InventoryChanged",
        payload: {
          characterId: actor.characterId ?? actor.id,
          characterName: actor.characterId ?? actor.id,
          action: "use",
          itemName: input.itemName,
          quantity: 1,
        },
      });
    }

    const targetName = target.characterId ?? target.monsterId ?? target.npcId ?? target.id;
    const hpNote = healingApplied > 0 ? ` heals ${healingApplied} HP (${target.hpCurrent} → ${hpAfter})` : "";
    return {
      message: `${actor.characterId ?? actor.id} administers ${input.itemName} to ${targetName}.${hpNote}`,
      healingApplied,
      inventoryEvent: "administer",
    };
  }

  // -------------------------------------------------------------------------

  private resolveGiveCost(ac: ItemActionCosts | undefined): "free-object-interaction" | "utilize" | "none" {
    const cost = ac?.give ?? "free-object-interaction";
    if (cost !== "free-object-interaction" && cost !== "utilize" && cost !== "none") {
      throw new ValidationError(`Unsupported actionCosts.give: ${cost}`);
    }
    return cost;
  }

  private resolveAdministerCost(ac: ItemActionCosts | undefined): "action" | "bonus" | "utilize" | "none" {
    const cost = ac?.administer ?? "utilize";
    if (cost !== "action" && cost !== "bonus" && cost !== "utilize" && cost !== "none") {
      throw new ValidationError(`Unsupported actionCosts.administer: ${cost}`);
    }
    return cost;
  }

  private consumeGiveCost(
    actor: CombatantStateRecord,
    cost: "free-object-interaction" | "utilize" | "none",
  ): Record<string, unknown> {
    const r = normalizeResources(actor.resources ?? {});
    if (cost === "none") throw new ValidationError("This item cannot be given in combat.");
    if (cost === "free-object-interaction") {
      if (!hasFreeObjectInteractionAvailable(r as never)) {
        throw new ValidationError(
          "Free object interaction already spent this turn. Retry with explicit Utilize action if desired.",
        );
      }
      return useFreeObjectInteraction(r as never) as unknown as Record<string, unknown>;
    }
    // utilize
    if (hasSpentAction(r as never)) {
      throw new ValidationError("Action already spent this turn — cannot give via Utilize action.");
    }
    return spendAction(r as never) as unknown as Record<string, unknown>;
  }

  private consumeAdministerCost(
    actor: CombatantStateRecord,
    cost: "action" | "bonus" | "utilize" | "none",
  ): Record<string, unknown> {
    const r = normalizeResources(actor.resources ?? {});
    if (cost === "none") throw new ValidationError("This item cannot be administered in combat.");
    if (cost === "bonus") {
      if (!hasBonusActionAvailable(r as never)) {
        throw new ValidationError("Bonus action already spent this turn.");
      }
      return useBonusAction(r as never) as unknown as Record<string, unknown>;
    }
    // action or utilize — both consume the regular action
    if (hasSpentAction(r as never)) {
      throw new ValidationError("Action already spent this turn.");
    }
    return spendAction(r as never) as unknown as Record<string, unknown>;
  }
}
