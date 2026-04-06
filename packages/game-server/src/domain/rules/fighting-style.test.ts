/**
 * Fighting Style System Tests
 * 
 * Tests for the unified fighting style / feat system.
 */
import { describe, it, expect } from "vitest";
import {
  computeFeatModifiers,
  shouldApplyDueling,
  shouldApplyGreatWeaponFighting,
  FEAT_ARCHERY,
  FEAT_DEFENSE,
  FEAT_DUELING,
  FEAT_GREAT_WEAPON_FIGHTING,
  FEAT_PROTECTION,
  FEAT_RESILIENT,
  FEAT_TWO_WEAPON_FIGHTING,
} from "./feat-modifiers.js";

describe("Fighting Style feat modifiers", () => {
  describe("Archery", () => {
    it("grants +2 to ranged attack rolls", () => {
      const mods = computeFeatModifiers([FEAT_ARCHERY]);
      expect(mods.rangedAttackBonus).toBe(2);
    });

    it("does not grant ranged bonus without the feat", () => {
      const mods = computeFeatModifiers([]);
      expect(mods.rangedAttackBonus).toBe(0);
    });
  });

  describe("Defense", () => {
    it("grants +1 AC while armored", () => {
      const mods = computeFeatModifiers([FEAT_DEFENSE]);
      expect(mods.armorClassBonusWhileArmored).toBe(1);
    });

    it("does not grant AC bonus without the feat", () => {
      const mods = computeFeatModifiers([]);
      expect(mods.armorClassBonusWhileArmored).toBe(0);
    });
  });

  describe("Dueling", () => {
    it("grants +2 damage bonus", () => {
      const mods = computeFeatModifiers([FEAT_DUELING]);
      expect(mods.duelingDamageBonus).toBe(2);
    });

    it("does not grant bonus without the feat", () => {
      const mods = computeFeatModifiers([]);
      expect(mods.duelingDamageBonus).toBe(0);
    });
  });

  describe("Great Weapon Fighting", () => {
    it("sets damage die minimum to 3", () => {
      const mods = computeFeatModifiers([FEAT_GREAT_WEAPON_FIGHTING]);
      expect(mods.greatWeaponFightingDamageDieMinimum).toBe(3);
    });
  });

  describe("Protection", () => {
    it("enables Protection", () => {
      const mods = computeFeatModifiers([FEAT_PROTECTION]);
      expect(mods.protectionEnabled).toBe(true);
    });

    it("does not enable without the feat", () => {
      const mods = computeFeatModifiers([]);
      expect(mods.protectionEnabled).toBe(false);
    });
  });

  describe("Two-Weapon Fighting", () => {
    it("enables adding ability modifier to bonus attack damage", () => {
      const mods = computeFeatModifiers([FEAT_TWO_WEAPON_FIGHTING]);
      expect(mods.twoWeaponFightingAddsAbilityModifierToBonusAttackDamage).toBe(true);
    });
  });

  describe("Resilient", () => {
    it("enables Resilient when feat is present", () => {
      const mods = computeFeatModifiers([FEAT_RESILIENT]);
      expect(mods.resilientEnabled).toBe(true);
    });

    it("does not enable Resilient without the feat", () => {
      const mods = computeFeatModifiers([]);
      expect(mods.resilientEnabled).toBe(false);
    });
  });
});

describe("shouldApplyDueling", () => {
  it("applies to one-handed melee attack", () => {
    expect(shouldApplyDueling({
      attackKind: "melee",
      weapon: { hands: 1 },
    })).toBe(true);
  });

  it("applies to melee attack with no hands specified (defaults to one-handed)", () => {
    expect(shouldApplyDueling({
      attackKind: "melee",
    })).toBe(true);
  });

  it("does not apply to ranged attacks", () => {
    expect(shouldApplyDueling({
      attackKind: "ranged",
      weapon: { hands: 1 },
    })).toBe(false);
  });

  it("does not apply to two-handed weapons", () => {
    expect(shouldApplyDueling({
      attackKind: "melee",
      weapon: { hands: 2, properties: ["Two-Handed"] },
    })).toBe(false);
  });

  it("does not apply when wielding two-handed", () => {
    expect(shouldApplyDueling({
      attackKind: "melee",
      weapon: { hands: 2 },
    })).toBe(false);
  });

  it("applies to versatile weapon wielded in one hand", () => {
    expect(shouldApplyDueling({
      attackKind: "melee",
      weapon: { hands: 1, properties: ["Versatile"] },
    })).toBe(true);
  });
});

describe("shouldApplyGreatWeaponFighting (existing)", () => {
  it("applies to two-handed melee with Two-Handed property", () => {
    expect(shouldApplyGreatWeaponFighting({
      attackKind: "melee",
      weapon: { hands: 2, properties: ["Two-Handed"] },
    })).toBe(true);
  });

  it("applies to versatile weapon wielded in two hands", () => {
    expect(shouldApplyGreatWeaponFighting({
      attackKind: "melee",
      weapon: { hands: 2, properties: ["Versatile"] },
    })).toBe(true);
  });

  it("does not apply to one-handed melee", () => {
    expect(shouldApplyGreatWeaponFighting({
      attackKind: "melee",
      weapon: { hands: 1 },
    })).toBe(false);
  });
});
