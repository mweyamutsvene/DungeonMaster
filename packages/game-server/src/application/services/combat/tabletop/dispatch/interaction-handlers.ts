/**
 * InteractionHandlers — pickup, drop, draw, sheathe, and use-item action handlers.
 *
 * Extracted from ActionDispatcher (Phase: God-Module Decomposition §2.2).
 */

import { nanoid } from "nanoid";
import { ValidationError } from "../../../../errors.js";
import type { CombatMap } from "../../../../../domain/rules/combat-map.js";
import {
  getGroundItemsNearPosition,
  removeGroundItem,
  addGroundItem,
} from "../../../../../domain/rules/combat-map.js";
import {
  getPosition,
  normalizeResources,
  readBoolean,
  getDrawnWeapons,
  isWeaponDrawn,
  addDrawnWeapon,
  removeDrawnWeapon,
  getInventory,
  addActiveEffectsToResources,
  getActiveEffects,
  setActiveEffects,
} from "../../helpers/resource-utils.js";
import { findCombatantByEntityId } from "../../helpers/combatant-lookup.js";
import {
  findInventoryItem,
  useConsumableItem,
  addInventoryItem,
} from "../../../../../domain/entities/items/inventory.js";
import {
  lookupMagicItem,
} from "../../../../../domain/entities/items/magic-item-catalog.js";
import {
  addCondition,
  removeCondition,
  normalizeConditions,
  type Condition,
} from "../../../../../domain/entities/combat/conditions.js";
import { createEffect } from "../../../../../domain/entities/combat/effects.js";
import {
  inferActorRef,
  getActorNameFromRoster,
  findCombatantByName,
} from "../combat-text-parser.js";
import { getEntityIdFromRef } from "../../helpers/combatant-ref.js";
import { ItemActionHandler } from "../../item-action-handler.js";
import type { TabletopEventEmitter } from "../tabletop-event-emitter.js";
import type { TabletopCombatServiceDeps, ActionParseResult } from "../tabletop-types.js";
import type { LlmRoster } from "../../../../commands/game-command.js";

export class InteractionHandlers {
  constructor(
    private readonly deps: TabletopCombatServiceDeps,
    private readonly eventEmitter: TabletopEventEmitter,
    private readonly debugLogsEnabled: boolean,
  ) {}

  /**
   * Handle "pick up <item>" from the ground.
   * D&D 5e 2024: Equipping a weapon (including picking it up) is part of the Attack action.
   * Alternatively, picking up an item uses the Free Object Interaction (one per turn).
   */
  async handlePickupAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    itemName: string,
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    // Get encounter map
    const encounter = await this.deps.combatRepo.getEncounterById(encounterId);
    if (!encounter) throw new ValidationError("No encounter found");
    const map = encounter.mapData as unknown as CombatMap | undefined;
    if (!map) throw new ValidationError("No map data available");

    // Get actor position
    const combatants = await this.deps.combatRepo.listCombatants(encounterId);
    const actorCombatant = findCombatantByEntityId(combatants, actorId);
    if (!actorCombatant) throw new ValidationError("Actor not found in combat");

    const actorPos = getPosition(actorCombatant.resources ?? {});
    if (!actorPos) throw new ValidationError("Actor has no position");

    // Find matching ground item within 5ft
    const nearbyItems = getGroundItemsNearPosition(map, actorPos, 5);
    const itemNameLower = itemName.toLowerCase();
    const matchedItem = nearbyItems.find(i => i.name.toLowerCase() === itemNameLower)
      ?? nearbyItems.find(i => i.name.toLowerCase().includes(itemNameLower));

    if (!matchedItem) {
      const available = nearbyItems.map(i => i.name).join(", ");
      const hint = available ? ` Nearby items: ${available}.` : " There are no items nearby.";
      throw new ValidationError(`No "${itemName}" found within reach.${hint}`);
    }

    // Check free object interaction
    const resources = normalizeResources(actorCombatant.resources ?? {});
    const objectInteractionUsed = readBoolean(resources, "objectInteractionUsed") ?? false;
    if (objectInteractionUsed) {
      throw new ValidationError(
        "You've already used your free Object Interaction this turn. Use the Utilize action to interact with another object.",
      );
    }

    // Remove item from map
    const updatedMap = removeGroundItem(map, matchedItem.id);
    await this.deps.combatRepo.updateEncounter(encounterId, { mapData: updatedMap as any });

    // Add weapon to actor's attacks array if it has weapon stats
    if (matchedItem.weaponStats) {
      const actorResources = { ...(actorCombatant.resources as Record<string, unknown> ?? {}) };

      // For simplicity, store in resources.pickedUpWeapons to add to attacks at read time
      const pickedUp = Array.isArray(actorResources.pickedUpWeapons)
        ? [...actorResources.pickedUpWeapons, matchedItem.weaponStats]
        : [matchedItem.weaponStats];

      // Also add to drawnWeapons — picking up a weapon puts it in your hand
      const weaponName = (matchedItem.weaponStats as any)?.name;
      const pickupDrawnUpdate = weaponName
        ? addDrawnWeapon(actorResources, weaponName) as Record<string, unknown>
        : actorResources;

      await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
        resources: {
          ...pickupDrawnUpdate,
          pickedUpWeapons: pickedUp,
          objectInteractionUsed: true,
        } as any,
      });
    } else {
      // Non-weapon item — add to inventory if it has inventoryItem data, mark interaction used
      const actorResources = { ...(actorCombatant.resources as Record<string, unknown> ?? {}) };
      if (matchedItem.inventoryItem) {
        const inventory = getInventory(actorResources);
        const updatedInventory = addInventoryItem(inventory, matchedItem.inventoryItem);
        actorResources.inventory = updatedInventory;
      }
      await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
        resources: {
          ...actorResources,
          objectInteractionUsed: true,
        } as any,
      });
    }

    if (this.debugLogsEnabled) {
      console.log(`[InteractionHandlers] ${actorId} picked up ${matchedItem.name} from (${matchedItem.position.x}, ${matchedItem.position.y})`);
    }

    const actorName = getActorNameFromRoster(actorId, roster);
    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "SIMPLE_ACTION_COMPLETE",
      action: "Pickup",
      message: `${actorName} picks up the ${matchedItem.name}.`,
    };
  }

  /**
   * Handle "drop <item>" — remove a weapon from the actor's equipment/pickedUpWeapons
   * and place it on the ground at the actor's position.
   * D&D 5e 2024: Dropping an item costs no action at all (not even a free interaction).
   */
  async handleDropAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    itemName: string,
    characters: any[],
    monsters: any[],
    npcs: any[],
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    const encounter = await this.deps.combatRepo.getEncounterById(encounterId);
    if (!encounter) throw new ValidationError("No encounter found");
    const map = encounter.mapData as unknown as CombatMap | undefined;
    if (!map) throw new ValidationError("No map data available");

    const combatants = await this.deps.combatRepo.listCombatants(encounterId);
    const actorCombatant = findCombatantByEntityId(combatants, actorId);
    if (!actorCombatant) throw new ValidationError("Actor not found in combat");

    const actorPos = getPosition(actorCombatant.resources ?? {});
    if (!actorPos) throw new ValidationError("Actor has no position");

    // Resolve the actor's attacks from the entity (character/monster/npc), same pattern as handleAttackAction
    const actorEntity = characters.find((c) => c.id === actorId)
      ?? monsters.find((m) => m.id === actorId)
      ?? npcs.find((n) => n.id === actorId);
    const actorSheet = (actorEntity?.sheet ?? actorEntity?.statBlock ?? {}) as any;
    const sheetAttacks: Array<{ name: string; [key: string]: unknown }> = Array.isArray(actorSheet?.attacks) ? [...actorSheet.attacks] : [];

    const resources = { ...(actorCombatant.resources as Record<string, unknown> ?? {}) };
    const pickedUpWeapons: Array<{ name: string; [key: string]: unknown }> = Array.isArray(resources.pickedUpWeapons) ? [...resources.pickedUpWeapons as any[]] : [];

    const itemNameLower = itemName.toLowerCase();

    // Try pickedUpWeapons first (most recently acquired)
    let droppedWeapon: Record<string, unknown> | undefined;
    let fromPickedUp = false;
    const pickupIdx = pickedUpWeapons.findIndex(w => w.name.toLowerCase() === itemNameLower);
    if (pickupIdx >= 0) {
      droppedWeapon = pickedUpWeapons.splice(pickupIdx, 1)[0] as Record<string, unknown>;
      fromPickedUp = true;
    } else {
      // Try entity sheet attacks
      const attackIdx = sheetAttacks.findIndex(w => w.name.toLowerCase() === itemNameLower);
      if (attackIdx >= 0) {
        droppedWeapon = sheetAttacks.splice(attackIdx, 1)[0] as Record<string, unknown>;
      }
    }

    if (!droppedWeapon) {
      const available = [...sheetAttacks.map(a => a.name), ...pickedUpWeapons.map(p => p.name)].join(", ");
      const hint = available ? ` Available weapons: ${available}.` : " You have no weapons to drop.";
      throw new ValidationError(`You don't have a "${itemName}" to drop.${hint}`);
    }

    // Create ground item at actor's position
    const groundItem = {
      id: nanoid(),
      name: droppedWeapon.name as string,
      position: { ...actorPos },
      source: "dropped" as const,
      droppedBy: actorId,
      weaponStats: droppedWeapon as any,
    };
    const updatedMap = addGroundItem(map, groundItem);
    await this.deps.combatRepo.updateEncounter(encounterId, { mapData: updatedMap as any });

    // Update combatant/entity state
    // Also remove from drawnWeapons since the weapon is no longer in hand
    const updatedDropResources = removeDrawnWeapon(resources, groundItem.name) as Record<string, unknown>;

    if (fromPickedUp) {
      // Was in pickedUpWeapons — only update resources
      await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
        resources: { ...updatedDropResources, pickedUpWeapons } as any,
      });
    } else {
      // Was in entity sheet attacks — update the entity's sheet
      const isCharacter = characters.some((c) => c.id === actorId);
      if (isCharacter) {
        const updatedSheet = { ...actorSheet, attacks: sheetAttacks };
        await this.deps.characters.updateSheet(actorId, updatedSheet);
      }
      // Update combatant resources with drawnWeapons change
      await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
        resources: updatedDropResources as any,
      });
      // For monsters/NPCs, also store the reduced attacks list in combatant resources
      const isMonster = monsters.some((m) => m.id === actorId);
      if (isMonster) {
        await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
          resources: { ...updatedDropResources, sheet: { ...actorSheet, attacks: sheetAttacks } } as any,
        });
      }
    }

    if (this.debugLogsEnabled) {
      console.log(`[InteractionHandlers] ${actorId} dropped ${groundItem.name} at (${actorPos.x}, ${actorPos.y})`);
    }

    const actorName = getActorNameFromRoster(actorId, roster);
    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "SIMPLE_ACTION_COMPLETE",
      action: "Drop",
      message: `${actorName} drops the ${groundItem.name}.`,
    };
  }

  /**
   * Handle "draw <weapon>" — pull a stowed weapon into hand.
   * D&D 5e 2024: Costs the free Object Interaction (one per turn).
   * If the free interaction is already used, costs the Utilize action (standard action).
   */
  async handleDrawWeaponAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    weaponName: string,
    characters: any[],
    monsters: any[],
    npcs: any[],
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    const combatants = await this.deps.combatRepo.listCombatants(encounterId);
    const actorCombatant = findCombatantByEntityId(combatants, actorId);
    if (!actorCombatant) throw new ValidationError("Actor not found in combat");

    const resources = normalizeResources(actorCombatant.resources ?? {});

    // Find the weapon in the actor's available weapons (sheet.attacks + pickedUpWeapons)
    const actorEntity = characters.find((c) => c.id === actorId)
      ?? monsters.find((m) => m.id === actorId)
      ?? npcs.find((n) => n.id === actorId);
    const actorSheet = (actorEntity?.sheet ?? actorEntity?.statBlock ?? {}) as any;
    const sheetAttacks: Array<{ name: string }> = Array.isArray(actorSheet?.attacks) ? actorSheet.attacks : [];
    const pickedUpWeapons: Array<{ name: string }> = Array.isArray(resources.pickedUpWeapons) ? resources.pickedUpWeapons as any[] : [];

    const weaponNameLower = weaponName.toLowerCase();
    const allAvailable = [...sheetAttacks, ...pickedUpWeapons];
    const matchedWeapon = allAvailable.find(w => w.name?.toLowerCase() === weaponNameLower)
      ?? allAvailable.find(w => w.name?.toLowerCase().includes(weaponNameLower));

    if (!matchedWeapon) {
      const available = allAvailable.map(w => w.name).filter(Boolean).join(", ");
      const hint = available ? ` Available weapons: ${available}.` : " You have no weapons.";
      throw new ValidationError(`You don't have a "${weaponName}" to draw.${hint}`);
    }

    // Check if already drawn
    if (isWeaponDrawn(actorCombatant.resources ?? {}, matchedWeapon.name)) {
      throw new ValidationError(`${matchedWeapon.name} is already drawn.`);
    }

    // Check free object interaction
    const objectInteractionUsed = readBoolean(resources, "objectInteractionUsed") ?? false;
    let usedAction = false;

    if (objectInteractionUsed) {
      // Free interaction already spent — this costs the Utilize action
      const actionSpent = readBoolean(resources, "actionSpent") ?? false;
      if (actionSpent) {
        throw new ValidationError(
          "You've already used your free Object Interaction and your Action this turn. " +
          "You can draw the weapon on your next turn.",
        );
      }
      usedAction = true;
    }

    // Draw the weapon
    const updated = addDrawnWeapon(actorCombatant.resources ?? {}, matchedWeapon.name) as Record<string, unknown>;
    const persistResources: Record<string, unknown> = {
      ...updated,
      objectInteractionUsed: true,
      ...(usedAction ? { actionSpent: true } : {}),
    };

    await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
      resources: persistResources as any,
    });

    if (this.debugLogsEnabled) {
      console.log(`[InteractionHandlers] ${actorId} draws ${matchedWeapon.name}${usedAction ? " (Utilize action)" : " (free interaction)"}`);
    }

    const actorNameStr = getActorNameFromRoster(actorId, roster);
    const costNote = usedAction ? " (using Utilize action)" : "";
    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "SIMPLE_ACTION_COMPLETE",
      action: "Draw",
      message: `${actorNameStr} draws the ${matchedWeapon.name}${costNote}.`,
    };
  }

  /**
   * Handle "sheathe <weapon>" — stow a drawn weapon.
   * D&D 5e 2024: Costs the free Object Interaction (one per turn).
   * If the free interaction is already used, costs the Utilize action (standard action).
   */
  async handleSheatheWeaponAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    weaponName: string,
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    const combatants = await this.deps.combatRepo.listCombatants(encounterId);
    const actorCombatant = findCombatantByEntityId(combatants, actorId);
    if (!actorCombatant) throw new ValidationError("Actor not found in combat");

    const resources = normalizeResources(actorCombatant.resources ?? {});
    const drawn = getDrawnWeapons(actorCombatant.resources ?? {});

    // If drawnWeapons not initialized (legacy), can't sheathe
    if (!drawn) {
      throw new ValidationError("No weapon tracking available. Draw a weapon first.");
    }

    // Find the weapon in drawn weapons (fuzzy name match)
    const weaponNameLower = weaponName.toLowerCase();
    const matchedName = drawn.find(n => n.toLowerCase() === weaponNameLower)
      ?? drawn.find(n => n.toLowerCase().includes(weaponNameLower));

    if (!matchedName) {
      const hint = drawn.length > 0 ? ` Currently drawn: ${drawn.join(", ")}.` : " No weapons are drawn.";
      throw new ValidationError(`You don't have "${weaponName}" drawn.${hint}`);
    }

    // Check free object interaction
    const objectInteractionUsed = readBoolean(resources, "objectInteractionUsed") ?? false;
    let usedAction = false;

    if (objectInteractionUsed) {
      const actionSpent = readBoolean(resources, "actionSpent") ?? false;
      if (actionSpent) {
        throw new ValidationError(
          "You've already used your free Object Interaction and your Action this turn. " +
          "You can sheathe the weapon on your next turn.",
        );
      }
      usedAction = true;
    }

    // Sheathe the weapon
    const updated = removeDrawnWeapon(actorCombatant.resources ?? {}, matchedName) as Record<string, unknown>;
    const persistResources: Record<string, unknown> = {
      ...updated,
      objectInteractionUsed: true,
      ...(usedAction ? { actionSpent: true } : {}),
    };

    await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
      resources: persistResources as any,
    });

    if (this.debugLogsEnabled) {
      console.log(`[InteractionHandlers] ${actorId} sheathes ${matchedName}${usedAction ? " (Utilize action)" : " (free interaction)"}`);
    }

    const actorNameStr = getActorNameFromRoster(actorId, roster);
    const costNote = usedAction ? " (using Utilize action)" : "";
    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "SIMPLE_ACTION_COMPLETE",
      action: "Sheathe",
      message: `${actorNameStr} sheathes the ${matchedName}${costNote}.`,
    };
  }

  /**
   * Handle "use/drink <item>" action.
   * D&D 5e 2024: Drinking a potion costs an Action.
   * The item is consumed from the combatant's inventory.
   * Supports any item with a `potionEffects` definition on its MagicItemDefinition.
   */
  async handleUseItemAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    itemName: string,
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    const actor = inferActorRef(actorId, roster);

    // Get combatant state
    const combatants = await this.deps.combatRepo.listCombatants(encounterId);
    const actorCombatant = combatants.find(
      (c: any) => (c.combatantType === "Character" && c.characterId === actorId)
        || (c.combatantType === "Monster" && c.monsterId === actorId)
        || (c.combatantType === "NPC" && c.npcId === actorId),
    );
    if (!actorCombatant) throw new ValidationError("Actor not found in combat");

    let resources = normalizeResources(actorCombatant.resources);

    // Find item in combatant inventory
    const inventory = getInventory(actorCombatant.resources);
    const item = findInventoryItem(inventory, itemName);
    if (!item) {
      throw new ValidationError(`You don't have "${itemName}" in your inventory`);
    }
    if (item.quantity < 1) {
      throw new ValidationError(`No "${itemName}" remaining in inventory`);
    }

    // Look up item definition for effects
    const itemDef = item.magicItemId
      ? lookupMagicItem(item.name) ?? lookupMagicItem(itemName)
      : lookupMagicItem(itemName);

    if (!itemDef?.potionEffects && itemDef?.category !== "potion") {
      throw new ValidationError(`Don't know how to use "${itemName}". Only potions are supported.`);
    }

    // Resolve action-economy cost. D&D 5e 2024:
    // - Potions default to Bonus Action for self-use (2024 PHB rule change).
    // - Catalog entries may override via `actionCosts.use`.
    // - Spell-created items (Goodberry) explicitly declare `use: 'bonus'`.
    // Pre-2024 behavior (action-cost) is kept for items where `actionCosts.use`
    // is undefined AND we have no category default wired in — safer fallthrough.
    const useCost = itemDef?.actionCosts?.use;
    if (useCost === 'none') {
      throw new ValidationError(`"${itemName}" cannot be used in combat`);
    }
    const consumesBonusAction = useCost === 'bonus';
    if (consumesBonusAction) {
      if (resources.bonusActionUsed) {
        throw new ValidationError("You have already used your bonus action this turn");
      }
    } else if (resources.actionSpent) {
      throw new ValidationError("You have already used your action this turn");
    }

    // Consume the item
    const { updatedInventory } = useConsumableItem(inventory, itemName);

    const potionEffects = itemDef?.potionEffects;
    const actorName = getActorNameFromRoster(actorId, roster);
    const messageParts: string[] = [];

    // ── Apply healing ──────────────────────────────────────────────────
    if (potionEffects?.healing) {
      const formula = potionEffects.healing;
      // Flat-heal case (Goodberry = 0d0+1): skip dice roll entirely — rollDie
      // rejects count < 1. Use the modifier as the entire heal amount.
      const isFlatHeal = formula.diceCount === 0 || formula.diceSides === 0;
      let healAmount: number;
      let formulaLabel: string;
      if (isFlatHeal) {
        healAmount = formula.modifier ?? 0;
        formulaLabel = String(healAmount);
      } else {
        if (!this.deps.diceRoller) {
          throw new ValidationError("Dice roller not configured");
        }
        const diceResult = this.deps.diceRoller.rollDie(formula.diceSides, formula.diceCount, formula.modifier);
        healAmount = diceResult.total;
        formulaLabel = `${formula.diceCount}d${formula.diceSides}+${formula.modifier} = ${healAmount}`;
      }
      const hpBefore = actorCombatant.hpCurrent;
      const hpMax = actorCombatant.hpMax;
      const hpAfter = Math.min(hpMax, hpBefore + healAmount);
      const actualHeal = hpAfter - hpBefore;

      await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
        hpCurrent: hpAfter,
      });

      messageParts.push(`heals ${actualHeal} HP (${formulaLabel}). HP: ${hpAfter}/${hpMax}`);
    }

    // ── Apply instant damage ───────────────────────────────────────────
    if (potionEffects?.damage) {
      const dmg = potionEffects.damage;
      if (!this.deps.diceRoller) {
        throw new ValidationError("Dice roller not configured");
      }
      // Check for save to resist
      let applyDamage = true;
      if (potionEffects.save) {
        // For now, we always apply damage on fail – tabletop mode doesn't prompt for saves here
        // The save for Potion of Poison conditions (Poisoned) is resolved below
        // Full save mechanics are a future enhancement
        applyDamage = true;
      }

      if (applyDamage) {
        const diceResult = this.deps.diceRoller.rollDie(dmg.diceSides, dmg.diceCount, 0);
        const dmgAmount = diceResult.total;
        const hpBefore = actorCombatant.hpCurrent;
        const hpAfter = Math.max(0, hpBefore - dmgAmount);

        await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
          hpCurrent: hpAfter,
        });

        messageParts.push(`takes ${dmgAmount} ${dmg.damageType} damage`);
      }
    }

    // ── Apply temp HP ──────────────────────────────────────────────────
    if (potionEffects?.tempHp && potionEffects.tempHp > 0) {
      const newTempHp = potionEffects.tempHp;
      const currentRes = normalizeResources(actorCombatant.resources);
      const existingTempHp = typeof currentRes.tempHp === "number" ? currentRes.tempHp : 0;
      // Temp HP doesn't stack — take the higher value (D&D 5e 2024)
      if (newTempHp > existingTempHp) {
        resources = { ...resources, tempHp: newTempHp };
      }
      messageParts.push(`gains ${newTempHp} temporary HP`);
    }

    // ── Apply ActiveEffects ────────────────────────────────────────────
    if (potionEffects?.effects && potionEffects.effects.length > 0) {
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
      resources = addActiveEffectsToResources(resources, ...newEffects) as typeof resources;

      // Build effect summary for the message
      const effectNames = [...new Set(potionEffects.effects.map(e => e.source ?? e.description ?? e.type))];
      messageParts.push(`gains: ${effectNames.join(", ")}`);
    }

    // ── Apply conditions ───────────────────────────────────────────────
    let updatedConditions = normalizeConditions(actorCombatant.conditions as unknown[]);
    if (potionEffects?.applyConditions && potionEffects.applyConditions.length > 0) {
      for (const cond of potionEffects.applyConditions) {
        updatedConditions = addCondition(updatedConditions, {
          condition: cond.condition as Condition,
          duration: cond.duration as any,
          ...(cond.roundsRemaining !== undefined ? { roundsRemaining: cond.roundsRemaining } : {}),
        });
      }
      const condNames = potionEffects.applyConditions.map(c => c.condition).join(", ");
      messageParts.push(`gains condition(s): ${condNames}`);
    }

    // ── Remove conditions ──────────────────────────────────────────────
    if (potionEffects?.removeConditions && potionEffects.removeConditions.length > 0) {
      for (const condName of potionEffects.removeConditions) {
        updatedConditions = removeCondition(updatedConditions, condName as Condition);
      }
      const condNames = potionEffects.removeConditions.join(", ");
      messageParts.push(`removes condition(s): ${condNames}`);
    }

    // ── Persist all changes ────────────────────────────────────────────
    const finalResources = {
      ...resources,
      ...(consumesBonusAction ? { bonusActionUsed: true } : { actionSpent: true }),
      inventory: updatedInventory,
    };

    await this.deps.combatRepo.updateCombatantState(actorCombatant.id, {
      resources: finalResources as any,
      conditions: updatedConditions as any,
    });

    const effectSummary = messageParts.length > 0 ? ` ${messageParts.join("; ")}` : "";
    const message = `${actorName} drinks ${item.name}.${effectSummary}`;

    if (this.debugLogsEnabled) {
      console.log(`[InteractionHandlers] ${actorId} used ${item.name}. Effects: ${messageParts.join("; ")}`);
    }

    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "SIMPLE_ACTION_COMPLETE",
      action: "Use Item",
      message,
    };
  }

  /**
   * Handle "give <item> to <target>" / "hand <item> to <target>".
   * D&D 5e 2024: transferring to a willing, conscious ally within reach uses
   * the Free Object Interaction (default) or Utilize action per the item's
   * `actionCosts.give`. Transfer is atomic via `InventoryService.transferItem`
   * (optimistic concurrency + UoW) so both character sheets update together
   * or not at all. Both combatants' live `resources.inventory` are mirrored.
   */
  async handleGiveItemAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    itemName: string,
    targetName: string,
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    if (!this.deps.inventoryService) {
      throw new ValidationError("InventoryService not configured — give not available.");
    }
    const handler = new ItemActionHandler({
      combat: this.deps.combatRepo,
      characters: this.deps.characters,
      inventoryService: this.deps.inventoryService,
      events: this.deps.events,
      diceRoller: this.deps.diceRoller,
    });

    const combatants = await this.deps.combatRepo.listCombatants(encounterId);
    const actorCombatant = findCombatantByEntityId(combatants, actorId);
    if (!actorCombatant) throw new ValidationError("Actor not found in combat");

    const targetRef = findCombatantByName(targetName, roster);
    if (!targetRef) throw new ValidationError(`Target "${targetName}" not found in encounter roster`);
    const targetEntityId = getEntityIdFromRef(targetRef);
    const targetCombatant = findCombatantByEntityId(combatants, targetEntityId);
    if (!targetCombatant) throw new ValidationError(`Target "${targetName}" not in combat`);

    const result = await handler.giveItem({
      sessionId,
      encounterId,
      actorCombatantId: actorCombatant.id,
      targetCombatantId: targetCombatant.id,
      itemName,
    });

    const actorName = getActorNameFromRoster(actorId, roster);
    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "SIMPLE_ACTION_COMPLETE",
      action: "Give Item",
      message: `${actorName} hands ${itemName} to ${targetName}. ${result.message}`,
    };
  }

  /**
   * Handle "feed <item> to <target>" / "administer <item> to <target>".
   * D&D 5e 2024: force-feed a consumable to another creature (works on
   * unconscious targets). The actor loses 1× item; the target receives its
   * `potionEffects` (healing, etc.). Default administer cost is Utilize; the
   * item's `actionCosts.administer` overrides (e.g. Goodberry = Bonus). If
   * healing lifts an Unconscious target above 0 HP, the condition is removed.
   */
  async handleAdministerItemAction(
    sessionId: string,
    encounterId: string,
    actorId: string,
    itemName: string,
    targetName: string,
    roster: LlmRoster,
  ): Promise<ActionParseResult> {
    if (!this.deps.inventoryService) {
      throw new ValidationError("InventoryService not configured — administer not available.");
    }
    const handler = new ItemActionHandler({
      combat: this.deps.combatRepo,
      characters: this.deps.characters,
      inventoryService: this.deps.inventoryService,
      events: this.deps.events,
      diceRoller: this.deps.diceRoller,
    });

    const combatants = await this.deps.combatRepo.listCombatants(encounterId);
    const actorCombatant = findCombatantByEntityId(combatants, actorId);
    if (!actorCombatant) throw new ValidationError("Actor not found in combat");

    const targetRef = findCombatantByName(targetName, roster);
    if (!targetRef) throw new ValidationError(`Target "${targetName}" not found in encounter roster`);
    const targetEntityId = getEntityIdFromRef(targetRef);
    const targetCombatant = findCombatantByEntityId(combatants, targetEntityId);
    if (!targetCombatant) throw new ValidationError(`Target "${targetName}" not in combat`);

    const result = await handler.administerItem({
      sessionId,
      encounterId,
      actorCombatantId: actorCombatant.id,
      targetCombatantId: targetCombatant.id,
      itemName,
    });

    const actorName = getActorNameFromRoster(actorId, roster);
    const hpSuffix = result.healingApplied && result.healingApplied > 0
      ? ` (+${result.healingApplied} HP)`
      : "";
    return {
      requiresPlayerInput: false,
      actionComplete: true,
      type: "SIMPLE_ACTION_COMPLETE",
      action: "Administer Item",
      message: `${actorName} administers ${itemName} to ${targetName}${hpSuffix}.`,
    };
  }
}
