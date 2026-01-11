import { describe, expect, it } from "vitest";
import {
  createPactMagicState,
  pactMagicSlotsForLevel,
  resetPactMagicOnShortRest,
  spendPactMagicSlot,
} from "./warlock.js";

describe("Warlock pact magic", () => {
  it("computes pact slots by level", () => {
    expect(pactMagicSlotsForLevel(1)).toEqual({ slotLevel: 1, slots: 1 });
    expect(pactMagicSlotsForLevel(2)).toEqual({ slotLevel: 1, slots: 2 });
    expect(pactMagicSlotsForLevel(3)).toEqual({ slotLevel: 2, slots: 2 });
    expect(pactMagicSlotsForLevel(5)).toEqual({ slotLevel: 3, slots: 2 });
    expect(pactMagicSlotsForLevel(9)).toEqual({ slotLevel: 5, slots: 2 });
    expect(pactMagicSlotsForLevel(11)).toEqual({ slotLevel: 5, slots: 3 });
    expect(pactMagicSlotsForLevel(17)).toEqual({ slotLevel: 5, slots: 4 });
  });

  it("spends and resets on short rest", () => {
    let s = createPactMagicState(2);
    expect(s.pool.current).toBe(2);
    expect(s.slotLevel).toBe(1);

    s = spendPactMagicSlot(s, 1);
    expect(s.pool.current).toBe(1);

    s = resetPactMagicOnShortRest(2, s);
    expect(s.pool.current).toBe(2);
    expect(s.pool.max).toBe(2);
    expect(s.slotLevel).toBe(1);
  });
});
