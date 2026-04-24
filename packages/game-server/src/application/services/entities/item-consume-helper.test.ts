/**
 * Unit tests for item-consume-helper.ts.
 */

import { describe, it, expect } from "vitest";
import { consumeItemFromInventory } from "./item-consume-helper.js";
import type { CharacterItemInstance } from "../../../domain/entities/items/magic-item.js";

function berry(qty: number, longRestsRemaining?: number): CharacterItemInstance {
  return {
    name: "Goodberry",
    magicItemId: "goodberry-berry",
    equipped: false,
    attuned: false,
    quantity: qty,
    longRestsRemaining,
  };
}

describe("consumeItemFromInventory", () => {
  it("decrements quantity by 1 and returns new sheet", () => {
    const sheet = { inventory: [berry(10, 1)], hp: 5 };
    const { sheet: next, consumed } = consumeItemFromInventory(sheet, "Goodberry");
    expect(next.inventory).toHaveLength(1);
    expect(next.inventory![0].quantity).toBe(9);
    expect(consumed.name).toBe("Goodberry");
    expect(consumed.quantity).toBe(1);
    // Other fields preserved.
    expect(next.hp).toBe(5);
  });

  it("removes the stack when quantity reaches 0", () => {
    const sheet = { inventory: [berry(1, 1)] };
    const { sheet: next } = consumeItemFromInventory(sheet, "Goodberry");
    expect(next.inventory).toHaveLength(0);
  });

  it("throws when item is missing", () => {
    const sheet = { inventory: [] };
    expect(() => consumeItemFromInventory(sheet, "Goodberry")).toThrow(/not found/i);
  });

  it("treats missing inventory as empty", () => {
    const sheet = {};
    expect(() => consumeItemFromInventory(sheet, "Goodberry")).toThrow(/not found/i);
  });

  it("is pure — does not mutate the original sheet or inventory array", () => {
    const original = berry(3, 1);
    const inv = [original];
    const sheet = { inventory: inv };
    consumeItemFromInventory(sheet, "Goodberry");
    expect(inv).toHaveLength(1);
    expect(inv[0].quantity).toBe(3);
    expect(original.quantity).toBe(3);
  });
});
