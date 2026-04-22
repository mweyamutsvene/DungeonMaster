import { describe, expect, it } from "vitest";
import {
  bardicInspirationDieForLevel,
  bardicInspirationUsesForLevel,
  createBardicInspirationState,
  resetBardicInspirationOnRest,
  spendBardicInspiration,
  Bard,
  BARD_COMBAT_TEXT_PROFILE,
} from "./bard.js";

describe("Bardic inspiration", () => {
  it("scales inspiration die by level", () => {
    expect(bardicInspirationDieForLevel(1)).toBe(6);
    expect(bardicInspirationDieForLevel(5)).toBe(8);
    expect(bardicInspirationDieForLevel(10)).toBe(10);
    expect(bardicInspirationDieForLevel(15)).toBe(12);
  });

  it("uses equal CHA mod (min 1)", () => {
    expect(bardicInspirationUsesForLevel(1, -1)).toBe(1);
    expect(bardicInspirationUsesForLevel(1, 0)).toBe(1);
    expect(bardicInspirationUsesForLevel(1, 3)).toBe(3);
  });

  it("spends and resets on correct rest type", () => {
    let s = createBardicInspirationState(4, 3);
    expect(s.pool.current).toBe(3);

    s = spendBardicInspiration(s, 2);
    expect(s.pool.current).toBe(1);

    // Pre-5: short rest does not refresh.
    const shortRestNoRefresh = resetBardicInspirationOnRest(4, 3, s, "short");
    expect(shortRestNoRefresh.pool.current).toBe(1);

    const longRestRefresh = resetBardicInspirationOnRest(4, 3, s, "long");
    expect(longRestRefresh.pool.current).toBe(3);

    // 5+: short rest refreshes.
    const at5 = createBardicInspirationState(5, 2);
    const spent = spendBardicInspiration(at5, 1);
    const shortRestRefresh = resetBardicInspirationOnRest(5, 2, spent, "short");
    expect(shortRestRefresh.pool.current).toBe(2);
  });
});

describe("Bard.resourcesAtLevel", () => {
  it("returns bardicInspiration pool using CHA modifier", () => {
    const pools = Bard.resourcesAtLevel!(3, { charisma: 3 });
    expect(pools).toEqual([{ name: "bardicInspiration", current: 3, max: 3 }]);
  });

  it("returns minimum 1 use when CHA modifier is 0 or negative", () => {
    const pools = Bard.resourcesAtLevel!(1, { charisma: -1 });
    expect(pools).toEqual([{ name: "bardicInspiration", current: 1, max: 1 }]);
  });

  it("defaults CHA modifier to 0 when abilityModifiers omitted", () => {
    const pools = Bard.resourcesAtLevel!(1);
    expect(pools).toEqual([{ name: "bardicInspiration", current: 1, max: 1 }]);
  });
});

describe("Bard.capabilitiesForLevel", () => {
  it("returns base capabilities at level 1", () => {
    const caps = Bard.capabilitiesForLevel!(1);
    expect(caps).toHaveLength(2);
    expect(caps.map(c => c.name)).toEqual(["Spellcasting", "Bardic Inspiration"]);
    expect(caps[1].resourceCost).toEqual({ pool: "bardicInspiration", amount: 1 });
    expect(caps[1].effect).toContain("d6");
  });

  it("includes Jack of All Trades at level 2", () => {
    const caps = Bard.capabilitiesForLevel!(2);
    expect(caps).toHaveLength(3);
    expect(caps.map(c => c.name)).toContain("Jack of All Trades");
  });

  it("includes Font of Inspiration at level 5 with d8", () => {
    const caps = Bard.capabilitiesForLevel!(5);
    expect(caps).toHaveLength(4);
    expect(caps.map(c => c.name)).toContain("Font of Inspiration");
    expect(caps.find(c => c.name === "Bardic Inspiration")!.effect).toContain("d8");
  });

  it("includes Countercharm at level 6", () => {
    const caps = Bard.capabilitiesForLevel!(6);
    expect(caps).toHaveLength(5);
    expect(caps.map(c => c.name)).toContain("Countercharm");
  });
});

describe("BARD_COMBAT_TEXT_PROFILE", () => {
  it("has correct classId", () => {
    expect(BARD_COMBAT_TEXT_PROFILE.classId).toBe("bard");
  });

  it("matches bardic inspiration patterns", () => {
    const mapping = BARD_COMBAT_TEXT_PROFILE.actionMappings[0];
    expect(mapping.keyword).toBe("bardic-inspiration");
    expect(mapping.category).toBe("bonusAction");
    expect(mapping.normalizedPatterns[0].test("bardicinspiration")).toBe(true);
    expect(mapping.normalizedPatterns[0].test("usebardicinspiration")).toBe(true);
    expect(mapping.normalizedPatterns[0].test("inspire")).toBe(true);
  });

  it("has no attack enhancements", () => {
    expect(BARD_COMBAT_TEXT_PROFILE.attackEnhancements).toEqual([]);
  });
});


import { classHasFeature as __chf_bd, hasFeature as __hf_bd } from "./registry.js";
import { CUTTING_WORDS, BARDIC_INSPIRATION } from "./feature-keys.js";
import { describe as __d_bd, it as __i_bd, expect as __e_bd } from "vitest";
__d_bd("Bard with College of Lore subclass", () => {
  __i_bd("exposes both base Bardic Inspiration (L1) and subclass Cutting Words (L3)", () => {
    const classLevels = [{ classId: "bard", level: 3 }];
    __e_bd(__hf_bd(classLevels, BARDIC_INSPIRATION)).toBe(true);
    __e_bd(__chf_bd("bard", CUTTING_WORDS, 3, "college-of-lore")).toBe(true);
    __e_bd(__chf_bd("bard", CUTTING_WORDS, 3)).toBe(false);
  });
});