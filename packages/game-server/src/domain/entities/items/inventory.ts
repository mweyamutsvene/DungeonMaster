/**
 * Inventory management for D&D 5e 2024.
 *
 * Inventory is stored as CharacterItemInstance[] on the character sheet
 * and copied into combatant resources during combat for runtime mutation.
 */

import type { CharacterItemInstance, MagicItemDefinition } from "./magic-item.js";

// ─── Legacy type (kept for backward compatibility with thrown/ammo tracking) ──

/**
 * A tracked item in a combatant's inventory (stored in resources.inventory).
 * Used for consumable/quantity-tracked items like thrown weapons and ammunition.
 */
export interface InventoryItem {
  /** Item name (matches weapon/attack name) */
  name: string;
  /** How many of this item the combatant has */
  quantity: number;
  /**
   * Weapon stats — stored so that when qty > 0, the weapon can appear in attacks[].
   * Same shape as character sheet attacks[].
   */
  weaponStats?: {
    name: string;
    kind: "melee" | "ranged";
    range?: string;
    attackBonus: number;
    damage: { diceCount: number; diceSides: number; modifier: number };
    versatileDamage?: { diceSides: number };
    damageType?: string;
    properties?: string[];
    mastery?: string;
  };
}

// ─── Inventory helpers (operate on CharacterItemInstance[]) ──────────────

/** Maximum number of attuned items per D&D 5e 2024 rules. */
export const MAX_ATTUNEMENT_SLOTS = 3;

/**
 * Find an item in the inventory by name (case-insensitive).
 * Returns the matching item or undefined.
 */
export function findInventoryItem(
  inventory: CharacterItemInstance[],
  itemName: string,
): CharacterItemInstance | undefined {
  const lower = itemName.toLowerCase();
  return inventory.find(i => i.name.toLowerCase() === lower);
}

/**
 * Add an item to the inventory. If an item with the same name exists
 * and is stackable (same magicItemId or no magicItemId), increments quantity.
 * Otherwise adds a new entry.
 */
export function addInventoryItem(
  inventory: CharacterItemInstance[],
  item: CharacterItemInstance,
): CharacterItemInstance[] {
  const existing = inventory.find(
    i => i.name.toLowerCase() === item.name.toLowerCase()
      && i.magicItemId === item.magicItemId,
  );
  if (existing) {
    return inventory.map(i =>
      i === existing ? { ...i, quantity: i.quantity + item.quantity } : i,
    );
  }
  return [...inventory, { ...item }];
}

/**
 * Remove quantity of an item from inventory. If quantity reaches 0, the item
 * is removed entirely. Returns the updated inventory.
 * Throws if the item is not found or insufficient quantity.
 */
export function removeInventoryItem(
  inventory: CharacterItemInstance[],
  itemName: string,
  amount = 1,
): CharacterItemInstance[] {
  const lower = itemName.toLowerCase();
  const idx = inventory.findIndex(i => i.name.toLowerCase() === lower);
  if (idx === -1) {
    throw new Error(`Item "${itemName}" not found in inventory`);
  }
  const item = inventory[idx];
  if (item.quantity < amount) {
    throw new Error(`Not enough "${itemName}" in inventory (have ${item.quantity}, need ${amount})`);
  }
  const newQty = item.quantity - amount;
  if (newQty <= 0) {
    return [...inventory.slice(0, idx), ...inventory.slice(idx + 1)];
  }
  return inventory.map((i, j) => (j === idx ? { ...i, quantity: newQty } : i));
}

/**
 * Use a consumable item (e.g., potion). Decrements quantity by 1.
 * Returns { updatedInventory, consumed: the item that was consumed }.
 * Throws if the item is not found or quantity is 0.
 */
export function useConsumableItem(
  inventory: CharacterItemInstance[],
  itemName: string,
): { updatedInventory: CharacterItemInstance[]; consumed: CharacterItemInstance } {
  const item = findInventoryItem(inventory, itemName);
  if (!item) {
    throw new Error(`Item "${itemName}" not found in inventory`);
  }
  if (item.quantity < 1) {
    throw new Error(`No "${itemName}" remaining in inventory`);
  }
  const updatedInventory = removeInventoryItem(inventory, itemName, 1);
  return { updatedInventory, consumed: { ...item, quantity: 1 } };
}

/**
 * Get the count of currently attuned items.
 */
export function getAttunedCount(inventory: CharacterItemInstance[]): number {
  return inventory.filter(i => i.attuned).length;
}

/**
 * Check if a character can attune to another item (max 3).
 */
export function canAttune(inventory: CharacterItemInstance[]): boolean {
  return getAttunedCount(inventory) < MAX_ATTUNEMENT_SLOTS;
}

/**
 * Get all equipped items from the inventory.
 */
export function getEquippedItems(inventory: CharacterItemInstance[]): CharacterItemInstance[] {
  return inventory.filter(i => i.equipped);
}

/**
 * Get all attuned items from the inventory.
 */
export function getAttunedItems(inventory: CharacterItemInstance[]): CharacterItemInstance[] {
  return inventory.filter(i => i.attuned);
}

// ─── Charge management ───────────────────────────────────────────────────

/**
 * Decrement charges on a charged item in the inventory.
 * Returns the updated inventory and the item after decrement.
 * Throws if the item is not found, has no charge system, or has 0 charges.
 */
export function useItemCharge(
  inventory: CharacterItemInstance[],
  itemName: string,
  amount = 1,
): { updatedInventory: CharacterItemInstance[]; item: CharacterItemInstance } {
  const item = findInventoryItem(inventory, itemName);
  if (!item) {
    throw new Error(`Item "${itemName}" not found in inventory`);
  }
  if (item.currentCharges === undefined) {
    throw new Error(`Item "${itemName}" does not use charges`);
  }
  if (item.currentCharges < amount) {
    throw new Error(
      `Not enough charges on "${itemName}" (have ${item.currentCharges}, need ${amount})`,
    );
  }
  const lower = itemName.toLowerCase();
  const updatedItem = { ...item, currentCharges: item.currentCharges - amount };
  const updatedInventory = inventory.map((i) =>
    i.name.toLowerCase() === lower ? updatedItem : i,
  );
  return { updatedInventory, item: updatedItem };
}

// ─── Magic item weapon/armor bonus helpers ───────────────────────────────

export interface WeaponMagicBonuses {
  /** Additive attack roll bonus (e.g. +1 for a +1 weapon). */
  attackBonus: number;
  /** Additive damage roll bonus (e.g. +1 for a +1 weapon). */
  damageBonus: number;
}

/**
 * Compute magic item bonuses for a weapon attack.
 *
 * Looks through the character's equipped inventory for a magic item whose
 * name matches the weapon (or whose baseWeapon matches). If found and the
 * item's definition has attackRolls/damageRolls modifiers, returns the bonuses.
 *
 * If the item requires attunement, the character must be attuned for bonuses to apply.
 *
 * @param inventory  The combatant's current inventory (CharacterItemInstance[])
 * @param weaponName The name of the weapon being used (e.g. "Longsword", "+1 Longsword")
 * @param lookupDef  Function to resolve magicItemId → MagicItemDefinition
 * @param attackKind "melee" | "ranged" — for scope filtering
 */
export function getWeaponMagicBonuses(
  inventory: CharacterItemInstance[],
  weaponName: string,
  lookupDef: (id: string) => MagicItemDefinition | undefined,
  attackKind?: "melee" | "ranged",
): WeaponMagicBonuses {
  const result: WeaponMagicBonuses = { attackBonus: 0, damageBonus: 0 };
  const lowerName = weaponName.toLowerCase();

  for (const item of inventory) {
    if (!item.equipped || !item.magicItemId) continue;

    const def = lookupDef(item.magicItemId);
    if (!def) continue;

    // Check attunement requirement
    if (def.attunement?.required && !item.attuned) continue;

    // Match weapon: item name matches weapon name, or baseWeapon matches weapon name
    const itemNameMatch = item.name.toLowerCase() === lowerName;
    const baseWeaponMatch = def.baseWeapon?.toLowerCase() === lowerName;
    // Also match if the weapon name is part of the magic item name ("+1 Longsword" for weapon "Longsword")
    const containsMatch = def.baseWeapon && item.name.toLowerCase().includes(lowerName);
    if (!itemNameMatch && !baseWeaponMatch && !containsMatch) continue;

    // Apply stat modifiers
    if (def.modifiers) {
      for (const mod of def.modifiers) {
        if (mod.target === "attackRolls" && mod.value) {
          const scope = mod.scope ?? "all";
          if (scope === "all" || scope === attackKind) {
            result.attackBonus += mod.value;
          }
        }
        if (mod.target === "damageRolls" && mod.value) {
          const scope = mod.scope ?? "all";
          if (scope === "all" || scope === attackKind) {
            result.damageBonus += mod.value;
          }
        }
      }
    }

    // Only apply the first matching weapon item (avoid double-counting)
    break;
  }

  return result;
}
