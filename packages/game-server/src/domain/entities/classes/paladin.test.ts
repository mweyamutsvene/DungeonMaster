import { describe, expect, it } from "vitest";
import {
  computeAuraSaveBonus,
  getAuraOfProtectionRange,
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
