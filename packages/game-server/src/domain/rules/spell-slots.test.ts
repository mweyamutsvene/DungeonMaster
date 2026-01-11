import { describe, expect, it } from "vitest";

import {
  canSpendSpellSlot,
  createSpellSlotsState,
  spendSpellSlot,
  restoreAllSpellSlots,
} from "./spell-slots.js";

describe("spell-slots", () => {
  it("spends and restores slots deterministically", () => {
    const slots = createSpellSlotsState({
      1: { current: 2, max: 2 },
    });

    expect(canSpendSpellSlot(slots, 1)).toBe(true);

    const after = spendSpellSlot(slots, 1);
    expect(after[1].current).toBe(1);

    const restored = restoreAllSpellSlots(after);
    expect(restored[1].current).toBe(2);
  });

  it("throws when spending with none remaining", () => {
    const slots = createSpellSlotsState({
      1: { current: 0, max: 1 },
    });

    expect(() => spendSpellSlot(slots, 1)).toThrow();
  });
});
