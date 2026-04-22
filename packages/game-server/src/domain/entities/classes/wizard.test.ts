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


import { classHasFeature as __chf_wz, hasFeature as __hf_wz } from "./registry.js";
import { SCULPT_SPELLS, ARCANE_RECOVERY } from "./feature-keys.js";
import { describe as __d_wz, it as __i_wz, expect as __e_wz } from "vitest";
__d_wz("Wizard with School of Evocation subclass", () => {
  __i_wz("exposes both base Arcane Recovery (L1) and subclass Sculpt Spells (L3)", () => {
    const classLevels = [{ classId: "wizard", level: 3 }];
    __e_wz(__hf_wz(classLevels, ARCANE_RECOVERY)).toBe(true);
    __e_wz(__chf_wz("wizard", SCULPT_SPELLS, 3, "school-of-evocation")).toBe(true);
    __e_wz(__chf_wz("wizard", SCULPT_SPELLS, 3)).toBe(false);
  });
});