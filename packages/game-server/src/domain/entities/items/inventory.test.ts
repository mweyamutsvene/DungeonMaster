/**
 * Unit tests for inventory helpers — stack-key semantics and expiry decrement.
 */

import { describe, it, expect } from "vitest";
import {
  addInventoryItem,
  decrementItemExpiries,
} from "./inventory.js";
import type { CharacterItemInstance } from "./magic-item.js";

function makeItem(
  overrides: Partial<CharacterItemInstance> & { name: string; quantity: number },
): CharacterItemInstance {
  return {
    equipped: false,
    attuned: false,
    ...overrides,
  };
}

describe("addInventoryItem — stack-merge key", () => {
  it("merges items with identical (name, magicItemId, longRestsRemaining)", () => {
    const existing: CharacterItemInstance[] = [
      makeItem({ name: "Goodberry", magicItemId: "goodberry-berry", longRestsRemaining: 1, quantity: 10 }),
    ];
    const result = addInventoryItem(
      existing,
      makeItem({ name: "Goodberry", magicItemId: "goodberry-berry", longRestsRemaining: 1, quantity: 10 }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].quantity).toBe(20);
    expect(result[0].longRestsRemaining).toBe(1);
  });

  it("splits items with different longRestsRemaining (today's berries vs yesterday's)", () => {
    const existing: CharacterItemInstance[] = [
      makeItem({ name: "Goodberry", magicItemId: "goodberry-berry", longRestsRemaining: 1, quantity: 8 }),
    ];
    const result = addInventoryItem(
      existing,
      makeItem({ name: "Goodberry", magicItemId: "goodberry-berry", longRestsRemaining: 2, quantity: 10 }),
    );
    expect(result).toHaveLength(2);
    expect(result.find(i => i.longRestsRemaining === 1)?.quantity).toBe(8);
    expect(result.find(i => i.longRestsRemaining === 2)?.quantity).toBe(10);
  });

  it("merges when both items have undefined longRestsRemaining (permanent)", () => {
    const existing: CharacterItemInstance[] = [
      makeItem({ name: "Potion of Healing", magicItemId: "potion-of-healing", quantity: 1 }),
    ];
    const result = addInventoryItem(
      existing,
      makeItem({ name: "Potion of Healing", magicItemId: "potion-of-healing", quantity: 2 }),
    );
    expect(result).toHaveLength(1);
    expect(result[0].quantity).toBe(3);
    expect(result[0].longRestsRemaining).toBeUndefined();
  });

  it("splits when one is permanent (undefined) and other has expiry", () => {
    const existing: CharacterItemInstance[] = [
      makeItem({ name: "Goodberry", magicItemId: "goodberry-berry", quantity: 1 }),
    ];
    const result = addInventoryItem(
      existing,
      makeItem({ name: "Goodberry", magicItemId: "goodberry-berry", longRestsRemaining: 1, quantity: 10 }),
    );
    expect(result).toHaveLength(2);
  });

  it("splits when magicItemId differs even with same name", () => {
    const existing: CharacterItemInstance[] = [
      makeItem({ name: "Potion", magicItemId: "potion-of-healing", quantity: 1 }),
    ];
    const result = addInventoryItem(
      existing,
      makeItem({ name: "Potion", magicItemId: "potion-of-climbing", quantity: 1 }),
    );
    expect(result).toHaveLength(2);
  });

  it("splits when both magicItemId are undefined but names differ case aside (no merge)", () => {
    // Different names = different stacks
    const existing: CharacterItemInstance[] = [
      makeItem({ name: "Goodberry", quantity: 5 }),
    ];
    const result = addInventoryItem(
      existing,
      makeItem({ name: "Apple", quantity: 5 }),
    );
    expect(result).toHaveLength(2);
  });
});

describe("decrementItemExpiries", () => {
  it("leaves permanent items untouched", () => {
    const inventory: CharacterItemInstance[] = [
      makeItem({ name: "Longsword", quantity: 1 }),
      makeItem({ name: "Potion of Healing", magicItemId: "potion-of-healing", quantity: 2 }),
    ];
    const { updated, expired } = decrementItemExpiries(inventory);
    expect(expired).toHaveLength(0);
    expect(updated).toHaveLength(2);
    expect(updated[0].longRestsRemaining).toBeUndefined();
    expect(updated[1].longRestsRemaining).toBeUndefined();
  });

  it("decrements longRestsRemaining on expiring items", () => {
    const inventory: CharacterItemInstance[] = [
      makeItem({ name: "Goodberry", magicItemId: "goodberry-berry", longRestsRemaining: 2, quantity: 10 }),
    ];
    const { updated, expired } = decrementItemExpiries(inventory);
    expect(expired).toHaveLength(0);
    expect(updated).toHaveLength(1);
    expect(updated[0].longRestsRemaining).toBe(1);
    expect(updated[0].quantity).toBe(10);
  });

  it("prunes items whose expiry reaches 0", () => {
    const inventory: CharacterItemInstance[] = [
      makeItem({ name: "Goodberry", magicItemId: "goodberry-berry", longRestsRemaining: 1, quantity: 10 }),
      makeItem({ name: "Longsword", quantity: 1 }),
    ];
    const { updated, expired } = decrementItemExpiries(inventory);
    expect(expired).toHaveLength(1);
    expect(expired[0].name).toBe("Goodberry");
    expect(expired[0].quantity).toBe(10);
    expect(updated).toHaveLength(1);
    expect(updated[0].name).toBe("Longsword");
  });

  it("handles mixed permanent + expiring items", () => {
    const inventory: CharacterItemInstance[] = [
      makeItem({ name: "Goodberry", magicItemId: "goodberry-berry", longRestsRemaining: 1, quantity: 5 }),
      makeItem({ name: "Apple", longRestsRemaining: 3, quantity: 2 }),
      makeItem({ name: "Longsword", quantity: 1 }),
    ];
    const { updated, expired } = decrementItemExpiries(inventory);
    expect(expired.map(i => i.name).sort()).toEqual(["Goodberry"]);
    expect(updated).toHaveLength(2);
    expect(updated.find(i => i.name === "Apple")?.longRestsRemaining).toBe(2);
    expect(updated.find(i => i.name === "Longsword")?.longRestsRemaining).toBeUndefined();
  });
});
