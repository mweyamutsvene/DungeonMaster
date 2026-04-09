import { describe, it, expect } from "vitest";
import { getCantripDamageDice, getUpcastBonusDice, getSpellAttackCount } from "./prepared-spell-definition.js";
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

// ─────────────────────── getSpellAttackCount ─────────────────────────

const ELDRITCH_BLAST: PreparedSpellDefinition = {
  name: "Eldritch Blast",
  level: 0,
  attackType: "ranged_spell",
  damage: { diceCount: 1, diceSides: 10 },
  multiAttack: { baseCount: 1, scaling: "cantrip" },
};

const SCORCHING_RAY: PreparedSpellDefinition = {
  name: "Scorching Ray",
  level: 2,
  attackType: "ranged_spell",
  damage: { diceCount: 2, diceSides: 6 },
  multiAttack: { baseCount: 3, scaling: "perLevel" },
};

describe("getSpellAttackCount", () => {
  describe("cantrip scaling (Eldritch Blast)", () => {
    it("returns 1 beam at levels 1-4", () => {
      expect(getSpellAttackCount(ELDRITCH_BLAST, 1)).toBe(1);
      expect(getSpellAttackCount(ELDRITCH_BLAST, 4)).toBe(1);
    });

    it("returns 2 beams at levels 5-10", () => {
      expect(getSpellAttackCount(ELDRITCH_BLAST, 5)).toBe(2);
      expect(getSpellAttackCount(ELDRITCH_BLAST, 10)).toBe(2);
    });

    it("returns 3 beams at levels 11-16", () => {
      expect(getSpellAttackCount(ELDRITCH_BLAST, 11)).toBe(3);
      expect(getSpellAttackCount(ELDRITCH_BLAST, 16)).toBe(3);
    });

    it("returns 4 beams at levels 17-20", () => {
      expect(getSpellAttackCount(ELDRITCH_BLAST, 17)).toBe(4);
      expect(getSpellAttackCount(ELDRITCH_BLAST, 20)).toBe(4);
    });
  });

  describe("perLevel scaling (Scorching Ray)", () => {
    it("returns 3 rays at base level 2", () => {
      expect(getSpellAttackCount(SCORCHING_RAY, 5, 2)).toBe(3);
    });

    it("returns 4 rays at level 3 (upcast)", () => {
      expect(getSpellAttackCount(SCORCHING_RAY, 5, 3)).toBe(4);
    });

    it("returns 5 rays at level 4 (upcast)", () => {
      expect(getSpellAttackCount(SCORCHING_RAY, 5, 4)).toBe(5);
    });

    it("returns 7 rays at level 6 (upcast)", () => {
      expect(getSpellAttackCount(SCORCHING_RAY, 5, 6)).toBe(7);
    });

    it("uses spell base level when castAtLevel is undefined", () => {
      expect(getSpellAttackCount(SCORCHING_RAY, 5)).toBe(3);
    });
  });

  describe("non-multi-attack spells", () => {
    it("returns 1 for Fire Bolt (no multiAttack field)", () => {
      expect(getSpellAttackCount(FIRE_BOLT, 17)).toBe(1);
    });

    it("returns 1 for any spell without multiAttack", () => {
      const magic: PreparedSpellDefinition = { name: "Magic Missile", level: 1 };
      expect(getSpellAttackCount(magic, 5)).toBe(1);
    });
  });
});
