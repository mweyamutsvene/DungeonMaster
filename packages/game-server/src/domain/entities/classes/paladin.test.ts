import { describe, expect, it } from "vitest";
import {
  computeAuraSaveBonus,
  getAuraOfProtectionRange,
  getPaladinAuraBonus,
  paladinChannelDivinityUsesForLevel,
  createChannelDivinityState,
  createLayOnHandsState,
  layOnHandsPoolForLevel,
  resetChannelDivinityOnShortRest,
  resetLayOnHandsOnLongRest,
  spendChannelDivinity,
  spendLayOnHands,
} from "./paladin.js";
import { classHasFeature } from "./registry.js";
import { WEAPON_MASTERY, SPELLCASTING, AURA_OF_PROTECTION } from "./feature-keys.js";

describe("Paladin channel divinity", () => {
  it("computes uses by level", () => {
    expect(paladinChannelDivinityUsesForLevel(2)).toBe(0);
    expect(paladinChannelDivinityUsesForLevel(3)).toBe(1);
    expect(paladinChannelDivinityUsesForLevel(7)).toBe(2);
    expect(paladinChannelDivinityUsesForLevel(18)).toBe(3);
  });

  it("spends and resets on short rest", () => {
    let s = createChannelDivinityState(7);
    expect(s.pool.current).toBe(2);

    s = spendChannelDivinity(s, 2);
    expect(s.pool.current).toBe(0);

    s = resetChannelDivinityOnShortRest(7, s);
    expect(s.pool.current).toBe(2);
    expect(s.pool.max).toBe(2);
  });
});

describe("Paladin lay on hands", () => {
  it("scales pool by level", () => {
    expect(layOnHandsPoolForLevel(1)).toBe(5);
    expect(layOnHandsPoolForLevel(5)).toBe(25);
  });

  it("spends points and resets on long rest", () => {
    let s = createLayOnHandsState(2);
    expect(s.pool.current).toBe(10);

    s = spendLayOnHands(s, 3);
    expect(s.pool.current).toBe(7);

    s = resetLayOnHandsOnLongRest(2, s);
    expect(s.pool.current).toBe(10);
    expect(s.pool.max).toBe(10);
  });
});

describe("Paladin feature keys", () => {
  it("has spellcasting at level 1 (D&D 2024)", () => {
    expect(classHasFeature("paladin", SPELLCASTING, 1)).toBe(true);
  });

  it("has weapon-mastery at level 1", () => {
    expect(classHasFeature("paladin", WEAPON_MASTERY, 1)).toBe(true);
  });

  it("has aura-of-protection at level 6+", () => {
    expect(classHasFeature("paladin", AURA_OF_PROTECTION, 5)).toBe(false);
    expect(classHasFeature("paladin", AURA_OF_PROTECTION, 6)).toBe(true);
    expect(classHasFeature("paladin", AURA_OF_PROTECTION, 18)).toBe(true);
  });
});

describe("Aura of Protection", () => {
  describe("getAuraOfProtectionRange", () => {
    it("returns 0 below level 6", () => {
      expect(getAuraOfProtectionRange(1)).toBe(0);
      expect(getAuraOfProtectionRange(5)).toBe(0);
    });

    it("returns 10 at levels 6-17", () => {
      expect(getAuraOfProtectionRange(6)).toBe(10);
      expect(getAuraOfProtectionRange(17)).toBe(10);
    });

    it("returns 30 at level 18+", () => {
      expect(getAuraOfProtectionRange(18)).toBe(30);
      expect(getAuraOfProtectionRange(20)).toBe(30);
    });
  });

  describe("computeAuraSaveBonus", () => {
    it("returns CHA modifier when positive", () => {
      expect(computeAuraSaveBonus(3)).toBe(3);
      expect(computeAuraSaveBonus(5)).toBe(5);
    });

    it("returns minimum 1 for zero/negative CHA modifier", () => {
      expect(computeAuraSaveBonus(0)).toBe(1);
      expect(computeAuraSaveBonus(-1)).toBe(1);
      expect(computeAuraSaveBonus(-3)).toBe(1);
    });

    it("returns 1 for CHA modifier of 1", () => {
      expect(computeAuraSaveBonus(1)).toBe(1);
    });
  });
});

// CLASS-M1: getPaladinAuraBonus — combined level gate + CHA modifier
describe("getPaladinAuraBonus", () => {
  it("returns CHA modifier when Paladin is level 6+", () => {
    expect(getPaladinAuraBonus({ charismaModifier: 4, level: 6 })).toBe(4);
  });

  it("returns 0 when Paladin is below level 6 (aura not active)", () => {
    expect(getPaladinAuraBonus({ charismaModifier: 4, level: 5 })).toBe(0);
    expect(getPaladinAuraBonus({ charismaModifier: 4, level: 1 })).toBe(0);
  });

  it("returns minimum 1 for negative CHA modifier when level 6+", () => {
    // Math.max(1, -1) = 1
    expect(getPaladinAuraBonus({ charismaModifier: -1, level: 6 })).toBe(1);
    expect(getPaladinAuraBonus({ charismaModifier: 0, level: 6 })).toBe(1);
  });

  it("scales correctly across levels", () => {
    expect(getPaladinAuraBonus({ charismaModifier: 3, level: 6 })).toBe(3);
    expect(getPaladinAuraBonus({ charismaModifier: 3, level: 18 })).toBe(3);
    expect(getPaladinAuraBonus({ charismaModifier: 3, level: 20 })).toBe(3);
  });
});


import { classHasFeature as __chf_pal, hasFeature as __hf_pal } from "./registry.js";
import { SACRED_WEAPON, DIVINE_SMITE } from "./feature-keys.js";
import { describe as __d_pal, it as __i_pal, expect as __e_pal } from "vitest";
__d_pal("Paladin with Oath of Devotion subclass", () => {
  __i_pal("exposes both base Divine Smite (L2) and subclass Sacred Weapon (L3)", () => {
    const classLevels = [{ classId: "paladin", level: 3 }];
    __e_pal(__hf_pal(classLevels, DIVINE_SMITE)).toBe(true);
    __e_pal(__chf_pal("paladin", SACRED_WEAPON, 3, "oath-of-devotion")).toBe(true);
    __e_pal(__chf_pal("paladin", SACRED_WEAPON, 3)).toBe(false);
  });
});