import { describe, it, expect } from "vitest";
import {
  arcaneRecoveryMaxRecoveredSlotLevels,
  validateArcaneRecovery,
} from "./wizard.js";

describe("arcaneRecoveryMaxRecoveredSlotLevels", () => {
  it("returns ceil(level / 2) across wizard levels", () => {
    expect(arcaneRecoveryMaxRecoveredSlotLevels(1)).toBe(1);
    expect(arcaneRecoveryMaxRecoveredSlotLevels(2)).toBe(1);
    expect(arcaneRecoveryMaxRecoveredSlotLevels(3)).toBe(2);
    expect(arcaneRecoveryMaxRecoveredSlotLevels(5)).toBe(3);
    expect(arcaneRecoveryMaxRecoveredSlotLevels(10)).toBe(5);
    expect(arcaneRecoveryMaxRecoveredSlotLevels(20)).toBe(10);
  });

  it("rejects invalid levels", () => {
    expect(() => arcaneRecoveryMaxRecoveredSlotLevels(0)).toThrow();
    expect(() => arcaneRecoveryMaxRecoveredSlotLevels(21)).toThrow();
  });
});

describe("validateArcaneRecovery", () => {
  it("accepts a single slot recovery within cap", () => {
    // L5 wizard: cap = 3 combined levels. Recover 1× L3 slot = 3 levels.
    const result = validateArcaneRecovery(5, { 3: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.totalLevels).toBe(3);
  });

  it("accepts a mix of slot levels within cap", () => {
    // L5 wizard: cap = 3. Recover 1× L2 + 1× L1 = 3 levels.
    const result = validateArcaneRecovery(5, { 2: 1, 1: 1 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.totalLevels).toBe(3);
  });

  it("rejects recovery exceeding the level cap", () => {
    // L5 wizard: cap = 3. Attempt 2× L3 slots = 6 levels.
    const result = validateArcaneRecovery(5, { 3: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/exceeds cap/i);
  });

  it("rejects 6th-level or higher slots (RAW gate)", () => {
    // L11+ wizard: cap = 6, but 6th-level slot is forbidden.
    const result = validateArcaneRecovery(11, { 6: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/6th\+|level-6/i);
  });

  it("rejects empty recovery maps", () => {
    const result = validateArcaneRecovery(5, {});
    expect(result.ok).toBe(false);
  });

  it("rejects invalid slot counts", () => {
    const result = validateArcaneRecovery(5, { 2: -1 });
    expect(result.ok).toBe(false);
  });

  it("rejects invalid slot levels", () => {
    const result = validateArcaneRecovery(5, { 0: 1 });
    expect(result.ok).toBe(false);
  });
});
