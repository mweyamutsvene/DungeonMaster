import { describe, expect, it } from "vitest";
import {
  arcaneRecoveryMaxRecoveredSlotLevels,
  createArcaneRecoveryState,
  resetArcaneRecoveryOnLongRest,
  spendArcaneRecovery,
} from "./wizard.js";

describe("Wizard arcane recovery", () => {
  it("computes recovery cap by level", () => {
    expect(arcaneRecoveryMaxRecoveredSlotLevels(1)).toBe(1);
    expect(arcaneRecoveryMaxRecoveredSlotLevels(2)).toBe(1);
    expect(arcaneRecoveryMaxRecoveredSlotLevels(3)).toBe(2);
    expect(arcaneRecoveryMaxRecoveredSlotLevels(5)).toBe(3);
  });

  it("spends and resets on long rest", () => {
    let s = createArcaneRecoveryState(1);
    expect(s.pool.current).toBe(1);

    s = spendArcaneRecovery(s, 1);
    expect(s.pool.current).toBe(0);

    s = resetArcaneRecoveryOnLongRest(1, s);
    expect(s.pool.current).toBe(1);
    expect(s.pool.max).toBe(1);
  });
});
