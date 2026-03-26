import { describe, it, expect } from "vitest";
import { getCantripDamageDice, getUpcastBonusDice } from "./prepared-spell-definition.js";
import type { PreparedSpellDefinition } from "./prepared-spell-definition.js";

describe("getCantripDamageDice", () => {
  it("returns base dice count at levels 1-4", () => {
    expect(getCantripDamageDice(1, 1)).toBe(1);
    expect(getCantripDamageDice(1, 4)).toBe(1);
  });

  it("doubles dice at level 5", () => {
    expect(getCantripDamageDice(1, 5)).toBe(2);
  });

  it("doubles dice at levels 5-10", () => {
    expect(getCantripDamageDice(1, 10)).toBe(2);
  });

  it("triples dice at level 11", () => {
    expect(getCantripDamageDice(1, 11)).toBe(3);
  });

  it("triples dice at levels 11-16", () => {
    expect(getCantripDamageDice(1, 16)).toBe(3);
  });

  it("quadruples dice at level 17", () => {
    expect(getCantripDamageDice(1, 17)).toBe(4);
  });

  it("quadruples dice at level 20", () => {
    expect(getCantripDamageDice(1, 20)).toBe(4);
  });

  it("scales correctly with non-1 base dice count", () => {
    // Some cantrips might have 2 base dice
    expect(getCantripDamageDice(2, 1)).toBe(2);
    expect(getCantripDamageDice(2, 5)).toBe(4);
    expect(getCantripDamageDice(2, 11)).toBe(6);
    expect(getCantripDamageDice(2, 17)).toBe(8);
  });

  it("Fire Bolt at canonical levels: 1d10/2d10/3d10/4d10", () => {
    // Fire Bolt has baseDiceCount=1, diceSides=10
    expect(getCantripDamageDice(1, 1)).toBe(1);   // 1d10
    expect(getCantripDamageDice(1, 5)).toBe(2);   // 2d10
    expect(getCantripDamageDice(1, 11)).toBe(3);  // 3d10
    expect(getCantripDamageDice(1, 17)).toBe(4);  // 4d10
  });
});

// ─────────────────────── getUpcastBonusDice ─────────────────────────

/** Minimal Cure Wounds definition (level 1, +1d8 per level above 1st). */
const CURE_WOUNDS: PreparedSpellDefinition = {
  name: "Cure Wounds",
  level: 1,
  healing: { diceCount: 1, diceSides: 8, modifier: 3 },
  upcastScaling: { additionalDice: { diceCount: 1, diceSides: 8 } },
};

/** Minimal Burning Hands definition (level 1, +1d6 per level above 1st). */
const BURNING_HANDS: PreparedSpellDefinition = {
  name: "Burning Hands",
  level: 1,
  saveAbility: "dexterity",
  damage: { diceCount: 3, diceSides: 6 },
  upcastScaling: { additionalDice: { diceCount: 1, diceSides: 6 } },
};

/** Cantrip — no upcast scaling. */
const FIRE_BOLT: PreparedSpellDefinition = {
  name: "Fire Bolt",
  level: 0,
  attackType: "ranged_spell",
  damage: { diceCount: 1, diceSides: 10 },
};

describe("getUpcastBonusDice", () => {
  it("returns null for a cantrip with no upcastScaling", () => {
    expect(getUpcastBonusDice(FIRE_BOLT, 0)).toBeNull();
    expect(getUpcastBonusDice(FIRE_BOLT, 1)).toBeNull();
  });

  it("returns null when castAtLevel is undefined", () => {
    expect(getUpcastBonusDice(CURE_WOUNDS, undefined)).toBeNull();
  });

  it("returns null when castAtLevel equals the spell level (not an upcast)", () => {
    expect(getUpcastBonusDice(CURE_WOUNDS, 1)).toBeNull();
  });

  it("returns null when castAtLevel is below spell level", () => {
    // Defensive: caller should validate, but function handles gracefully
    expect(getUpcastBonusDice(CURE_WOUNDS, 0)).toBeNull();
  });

  it("Cure Wounds at level 2 → +1d8 bonus (1 level above base)", () => {
    const result = getUpcastBonusDice(CURE_WOUNDS, 2);
    expect(result).toEqual({ bonusDiceCount: 1, diceSides: 8 });
  });

  it("Cure Wounds at level 3 → +2d8 bonus (2 levels above base)", () => {
    const result = getUpcastBonusDice(CURE_WOUNDS, 3);
    expect(result).toEqual({ bonusDiceCount: 2, diceSides: 8 });
  });

  it("Cure Wounds at level 9 → +8d8 bonus (8 levels above base)", () => {
    const result = getUpcastBonusDice(CURE_WOUNDS, 9);
    expect(result).toEqual({ bonusDiceCount: 8, diceSides: 8 });
  });

  it("Burning Hands at level 2 → +1d6 bonus", () => {
    const result = getUpcastBonusDice(BURNING_HANDS, 2);
    expect(result).toEqual({ bonusDiceCount: 1, diceSides: 6 });
  });

  it("Burning Hands at level 5 → +4d6 bonus (4 levels above base)", () => {
    const result = getUpcastBonusDice(BURNING_HANDS, 5);
    expect(result).toEqual({ bonusDiceCount: 4, diceSides: 6 });
  });

  it("spell without upcastScaling field returns null even when upcast", () => {
    const noScaling: PreparedSpellDefinition = { name: "Magic Missile", level: 1 };
    expect(getUpcastBonusDice(noScaling, 3)).toBeNull();
  });
});
