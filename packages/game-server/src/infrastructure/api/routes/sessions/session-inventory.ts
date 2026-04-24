/**
 * Session Inventory Routes
 *
 * Manages character inventory items (out-of-combat). Inventory is persisted
 * as CharacterItemInstance[] on the character sheet and copied into combatant
 * resources at combat start.
 *
 * Endpoints:
 * - GET  /sessions/:id/characters/:charId/inventory        — List inventory
 * - POST /sessions/:id/characters/:charId/inventory        — Add item
 * - DELETE /sessions/:id/characters/:charId/inventory/:itemName — Remove item
 * - PATCH /sessions/:id/characters/:charId/inventory/:itemName  — Equip/attune
 * - POST /sessions/:id/characters/:charId/inventory/:itemName/use-charge — Decrement charges
 * - POST /sessions/:id/characters/:charId/inventory/:itemName/use       — Use a consumable item (potion, etc.)
 */

import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import type { SessionRouteDeps } from "./types.js";
import { NotFoundError, ValidationError } from "../../../../application/errors.js";
import type { CharacterItemInstance } from "../../../../domain/entities/items/magic-item.js";
import {
  addInventoryItem,
  removeInventoryItem,
  findInventoryItem,
  getAttunedCount,
  useItemCharge,
  useConsumableItem,
  MAX_ATTUNEMENT_SLOTS,
} from "../../../../domain/entities/items/inventory.js";
import { recomputeArmorFromInventory } from "../../../../domain/entities/items/armor-catalog.js";

function getInventoryFromSheet(sheet: Record<string, unknown>): CharacterItemInstance[] {
  return Array.isArray(sheet.inventory) ? (sheet.inventory as CharacterItemInstance[]) : [];
}

async function saveInventory(
  deps: SessionRouteDeps,
  charId: string,
  sheet: Record<string, unknown>,
  inventory: CharacterItemInstance[],
) {
  const updatedSheet = { ...sheet, inventory };
  await deps.charactersRepo.updateSheet(charId, updatedSheet);
  return inventory;
}

async function emitInventoryChanged(
  deps: SessionRouteDeps,
  sessionId: string,
  characterId: string,
  characterName: string,
  action: "add" | "remove" | "equip" | "use-charge" | "use",
  itemName: string,
) {
  await deps.events.append(sessionId, {
    id: nanoid(),
    type: "InventoryChanged",
    payload: { characterId, characterName, action, itemName },
  });
}

export function registerSessionInventoryRoutes(app: FastifyInstance, deps: SessionRouteDeps): void {
  /**
   * GET /sessions/:id/characters/:charId/inventory
   * List all items in a character's inventory.
   */
  app.get<{
    Params: { id: string; charId: string };
  }>("/sessions/:id/characters/:charId/inventory", async (req) => {
    const char = await deps.charactersRepo.getById(req.params.charId);
    if (!char || char.sessionId !== req.params.id) {
      throw new NotFoundError(`Character not found: ${req.params.charId}`);
    }

    const sheet = (char.sheet as Record<string, unknown>) ?? {};
    const inventory = getInventoryFromSheet(sheet);

    return {
      characterId: char.id,
      characterName: char.name,
      inventory,
      attunedCount: getAttunedCount(inventory),
      maxAttunementSlots: MAX_ATTUNEMENT_SLOTS,
    };
  });

  /**
   * POST /sessions/:id/characters/:charId/inventory
   * Add an item to the character's inventory.
   *
   * Body: { name, magicItemId?, equipped?, attuned?, quantity?, slot? }
   */
  app.post<{
    Params: { id: string; charId: string };
    Body: {
      name: string;
      magicItemId?: string;
      equipped?: boolean;
      attuned?: boolean;
      quantity?: number;
      slot?: string;
    };
  }>("/sessions/:id/characters/:charId/inventory", async (req) => {
    const char = await deps.charactersRepo.getById(req.params.charId);
    if (!char || char.sessionId !== req.params.id) {
      throw new NotFoundError(`Character not found: ${req.params.charId}`);
    }

    const { name, magicItemId, equipped, attuned, quantity, slot } = req.body;
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      throw new ValidationError("Item name is required");
    }

    const sheet = (char.sheet as Record<string, unknown>) ?? {};
    const inventory = getInventoryFromSheet(sheet);

    // Check attunement capacity before adding attuned item
    if (attuned && getAttunedCount(inventory) >= MAX_ATTUNEMENT_SLOTS) {
      throw new ValidationError(
        `Cannot attune: already at maximum ${MAX_ATTUNEMENT_SLOTS} attuned items`,
      );
    }

    const newItem: CharacterItemInstance = {
      name: name.trim(),
      magicItemId,
      equipped: equipped ?? false,
      attuned: attuned ?? false,
      quantity: quantity ?? 1,
      slot: slot as CharacterItemInstance["slot"],
    };

    const updated = addInventoryItem(inventory, newItem);

    // Recompute sheet AC if equipping armor or shield
    const isArmorChange = newItem.equipped && (newItem.slot === "armor" || newItem.slot === "shield");
    if (isArmorChange) {
      const enrichedSheet = recomputeArmorFromInventory({ ...sheet, inventory: updated });
      await deps.charactersRepo.updateSheet(char.id, enrichedSheet);
      await emitInventoryChanged(deps, req.params.id, char.id, char.name, "add", newItem.name);
      return { inventory: updated };
    }

    await saveInventory(deps, char.id, sheet, updated);
    await emitInventoryChanged(deps, req.params.id, char.id, char.name, "add", newItem.name);

    return { inventory: updated };
  });

  /**
   * DELETE /sessions/:id/characters/:charId/inventory/:itemName
   * Remove item(s) from inventory. Query param `amount` controls quantity (default: 1).
   */
  app.delete<{
    Params: { id: string; charId: string; itemName: string };
    Querystring: { amount?: string };
  }>("/sessions/:id/characters/:charId/inventory/:itemName", async (req) => {
    const char = await deps.charactersRepo.getById(req.params.charId);
    if (!char || char.sessionId !== req.params.id) {
      throw new NotFoundError(`Character not found: ${req.params.charId}`);
    }

    const sheet = (char.sheet as Record<string, unknown>) ?? {};
    const inventory = getInventoryFromSheet(sheet);
    const itemName = decodeURIComponent(req.params.itemName);
    const amount = req.query.amount ? parseInt(req.query.amount, 10) : 1;

    if (isNaN(amount) || amount < 1) {
      throw new ValidationError("Amount must be a positive integer");
    }

    const updated = removeInventoryItem(inventory, itemName, amount);
    await saveInventory(deps, char.id, sheet, updated);
    await emitInventoryChanged(deps, req.params.id, char.id, char.name, "remove", itemName);

    return { inventory: updated };
  });

  /**
   * PATCH /sessions/:id/characters/:charId/inventory/:itemName
   * Update equip/attune state of an inventory item.
   *
   * Body: { equipped?, attuned?, slot? }
   */
  app.patch<{
    Params: { id: string; charId: string; itemName: string };
    Body: { equipped?: boolean; attuned?: boolean; slot?: string | null };
  }>("/sessions/:id/characters/:charId/inventory/:itemName", async (req) => {
    const char = await deps.charactersRepo.getById(req.params.charId);
    if (!char || char.sessionId !== req.params.id) {
      throw new NotFoundError(`Character not found: ${req.params.charId}`);
    }

    const sheet = (char.sheet as Record<string, unknown>) ?? {};
    const inventory = getInventoryFromSheet(sheet);
    const itemName = decodeURIComponent(req.params.itemName);

    const item = findInventoryItem(inventory, itemName);
    if (!item) {
      throw new NotFoundError(`Item "${itemName}" not found in inventory`);
    }

    const { equipped, attuned, slot } = req.body;

    // Validate attunement capacity
    if (attuned === true && !item.attuned) {
      if (getAttunedCount(inventory) >= MAX_ATTUNEMENT_SLOTS) {
        throw new ValidationError(
          `Cannot attune: already at maximum ${MAX_ATTUNEMENT_SLOTS} attuned items`,
        );
      }
    }

    const updated = inventory.map((i) => {
      if (i.name.toLowerCase() !== itemName.toLowerCase()) return i;
      return {
        ...i,
        ...(equipped !== undefined && { equipped }),
        ...(attuned !== undefined && { attuned }),
        ...(slot !== undefined && { slot: slot as CharacterItemInstance["slot"] }),
      };
    });

    // Recompute sheet AC if armor or shield equipment state changed
    const isArmorSlot = item.slot === "armor" || item.slot === "shield"
      || slot === "armor" || slot === "shield";
    const equipStateChanged = equipped !== undefined && equipped !== item.equipped;
    if (isArmorSlot && equipStateChanged) {
      const enrichedSheet = recomputeArmorFromInventory({ ...sheet, inventory: updated });
      await deps.charactersRepo.updateSheet(char.id, enrichedSheet);
      await emitInventoryChanged(deps, req.params.id, char.id, char.name, "equip", itemName);
      return { inventory: updated };
    }

    await saveInventory(deps, char.id, sheet, updated);
    await emitInventoryChanged(deps, req.params.id, char.id, char.name, "equip", itemName);

    return { inventory: updated };
  });

  /**
   * POST /sessions/:id/characters/:charId/inventory/:itemName/use-charge
   * Decrement charges on a charged item (e.g., Staff of Fire).
   *
   * Body: { amount? } — defaults to 1
   */
  app.post<{
    Params: { id: string; charId: string; itemName: string };
    Body: { amount?: number };
  }>("/sessions/:id/characters/:charId/inventory/:itemName/use-charge", async (req) => {
    const char = await deps.charactersRepo.getById(req.params.charId);
    if (!char || char.sessionId !== req.params.id) {
      throw new NotFoundError(`Character not found: ${req.params.charId}`);
    }

    const sheet = (char.sheet as Record<string, unknown>) ?? {};
    const inventory = getInventoryFromSheet(sheet);
    const itemName = decodeURIComponent(req.params.itemName);
    const amount = req.body?.amount ?? 1;

    if (!Number.isInteger(amount) || amount < 1) {
      throw new ValidationError("Amount must be a positive integer");
    }

    const item = findInventoryItem(inventory, itemName);
    if (!item) {
      throw new NotFoundError(`Item "${itemName}" not found in inventory`);
    }
    if (item.currentCharges === undefined) {
      throw new ValidationError(`Item "${itemName}" does not use charges`);
    }
    if (item.currentCharges < amount) {
      throw new ValidationError(
        `Not enough charges on "${itemName}" (have ${item.currentCharges}, need ${amount})`,
      );
    }

    const { updatedInventory, item: updatedItem } = useItemCharge(inventory, itemName, amount);
    await saveInventory(deps, char.id, sheet, updatedInventory);
    await emitInventoryChanged(deps, req.params.id, char.id, char.name, "use-charge", itemName);

    return { item: updatedItem, inventory: updatedInventory };
  });

  /**
   * POST /sessions/:id/characters/:charId/inventory/:itemName/use
   * Use a consumable item (e.g., drink a potion). Applies potion effects
   * (healing, temp HP, etc.) and removes one from inventory.
   *
   * Out-of-combat only — in combat, use the tabletop "use item" action.
   */
  app.post<{
    Params: { id: string; charId: string; itemName: string };
  }>("/sessions/:id/characters/:charId/inventory/:itemName/use", async (req) => {
    const char = await deps.charactersRepo.getById(req.params.charId);
    if (!char || char.sessionId !== req.params.id) {
      throw new NotFoundError(`Character not found: ${req.params.charId}`);
    }

    const sheet = (char.sheet as Record<string, unknown>) ?? {};
    const inventory = getInventoryFromSheet(sheet);
    const itemName = decodeURIComponent(req.params.itemName);

    const item = findInventoryItem(inventory, itemName);
    if (!item) {
      throw new NotFoundError(`Item "${itemName}" not found in inventory`);
    }

    // Look up magic item definition to check if it's consumable
    const itemDef = item.magicItemId
      ? await deps.itemLookup.lookupItem(item.magicItemId)
        ?? await deps.itemLookup.lookupItem(item.name)
        ?? await deps.itemLookup.lookupItem(itemName)
      : await deps.itemLookup.lookupItem(itemName);

    if (!itemDef?.potionEffects && itemDef?.category !== "potion") {
      throw new ValidationError(
        `Cannot use "${itemName}" — only consumable items (potions) can be used this way`,
      );
    }

    // Consume one from inventory
    const { updatedInventory, consumed } = useConsumableItem(inventory, itemName);

    const effects: string[] = [];
    let hpCurrent = typeof sheet.currentHp === "number" ? sheet.currentHp : (sheet.maxHp as number);
    const hpMax = (sheet.maxHp as number) ?? hpCurrent;

    // Apply healing
    if (itemDef?.potionEffects?.healing) {
      const formula = itemDef.potionEffects.healing;
      const diceRoller = deps.diceRoller;
      if (!diceRoller) {
        throw new ValidationError("Dice roller not configured");
      }
      const roll = diceRoller.rollDie(formula.diceSides, formula.diceCount, formula.modifier);
      const hpBefore = hpCurrent;
      hpCurrent = Math.min(hpMax, hpCurrent + roll.total);
      const actualHeal = hpCurrent - hpBefore;
      effects.push(`healed ${actualHeal} HP (rolled ${roll.total})`);
    }

    // Apply temp HP
    if (itemDef?.potionEffects?.tempHp && itemDef.potionEffects.tempHp > 0) {
      const existingTempHp = typeof sheet.tempHp === "number" ? (sheet.tempHp as number) : 0;
      const newTempHp = Math.max(existingTempHp, itemDef.potionEffects.tempHp);
      (sheet as Record<string, unknown>).tempHp = newTempHp;
      effects.push(`gained ${itemDef.potionEffects.tempHp} temporary HP`);
    }

    // Persist updated sheet
    const updatedSheet = {
      ...sheet,
      inventory: updatedInventory,
      currentHp: hpCurrent,
    };
    await deps.charactersRepo.updateSheet(char.id, updatedSheet);
    await emitInventoryChanged(deps, req.params.id, char.id, char.name, "use", itemName);

    return {
      used: consumed.name,
      effects,
      hpCurrent,
      hpMax,
      inventory: updatedInventory,
    };
  });

  /**
   * POST /sessions/:id/characters/:charId/inventory/:itemName/transfer
   * Transfer `quantity` of an item from the source character to `toCharId`.
   * Uses optimistic concurrency (sheetVersion) with single retry.
   */
  app.post<{
    Params: { id: string; charId: string; itemName: string };
    Body: { toCharId: string; quantity?: number };
  }>(
    "/sessions/:id/characters/:charId/inventory/:itemName/transfer",
    async (req) => {
      const { id: sessionId, charId: fromCharId } = req.params;
      const itemName = decodeURIComponent(req.params.itemName);
      const toCharId = req.body?.toCharId;
      const quantity = req.body?.quantity ?? 1;

      if (!toCharId || typeof toCharId !== "string") {
        throw new ValidationError("toCharId is required");
      }

      const result = await deps.inventoryService.transferItem(
        sessionId,
        fromCharId,
        toCharId,
        itemName,
        quantity,
      );

      return {
        itemName: result.item.name,
        quantity: result.quantity,
        fromInventory: result.fromInventory,
        toInventory: result.toInventory,
      };
    },
  );
}
