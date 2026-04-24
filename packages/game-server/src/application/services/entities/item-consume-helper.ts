/**
 * Pure sheet-level consumable helper.
 *
 * Wraps the inventory-domain `useConsumableItem` with sheet-shape semantics so
 * services (InventoryService, ItemActionHandler, SpellCastSideEffectProcessor)
 * can update a character sheet without re-implementing the inventory array
 * read/write dance.
 *
 * Pure — no I/O, no repository writes. Callers persist the returned sheet.
 */

import type { CharacterItemInstance } from "../../../domain/entities/items/magic-item.js";
import { useConsumableItem } from "../../../domain/entities/items/inventory.js";

export interface SheetWithInventory {
  inventory?: CharacterItemInstance[];
  // other sheet fields are untouched — typed as a passthrough via generic below
}

/**
 * Decrement a consumable by 1 on the given sheet. Returns the new sheet and
 * the item instance that was consumed.
 *
 * Throws (via `useConsumableItem`) when the item is missing or quantity is 0.
 */
export function consumeItemFromInventory<T extends SheetWithInventory>(
  sheet: T,
  itemName: string,
): { sheet: T; consumed: CharacterItemInstance } {
  const inventory = Array.isArray(sheet.inventory) ? sheet.inventory : [];
  const { updatedInventory, consumed } = useConsumableItem(inventory, itemName);
  return {
    sheet: { ...sheet, inventory: updatedInventory },
    consumed,
  };
}
