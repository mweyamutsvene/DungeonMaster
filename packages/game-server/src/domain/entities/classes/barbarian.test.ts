import { describe, expect, it } from "vitest";
import {
  Barbarian,
  barbarianUnarmoredDefenseAC,
  canUseBrutalStrike,
  createRageState,
  endRage,
  getBrutalStrikeBonusDice,
  isDangerSenseNegated,
  rageDamageBonusForLevel,
  rageUsesForLevel,
  resetRageOnLongRest,
  shouldRageEnd,
  startRage,
} from "./barbarian.js";
import { classHasFeature } from "./registry.js";
import { RAGE, RECKLESS_ATTACK, DANGER_SENSE, FERAL_INSTINCT, EXTRA_ATTACK, WEAPON_MASTERY, BRUTAL_STRIKE } from "./feature-keys.js";

describe("Barbarian rage", () => {
  it("computes rage uses by level", () => {
    expect(rageUsesForLevel(1)).toBe(2);
    expect(rageUsesForLevel(3)).toBe(3);
    expect(rageUsesForLevel(6)).toBe(4);
    expect(rageUsesForLevel(12)).toBe(5);
    expect(rageUsesForLevel(17)).toBe(6);
  });

  it("spends a rage use when starting rage", () => {
    let s = createRageState(1);
    expect(s.pool.current).toBe(2);

    s = startRage(s);
    expect(s.active).toBe(true);
    expect(s.pool.current).toBe(1);

    s = endRage(s);
    expect(s.active).toBe(false);
    expect(s.pool.current).toBe(1);

    s = resetRageOnLongRest(1, s);
    expect(s.active).toBe(false);
    expect(s.pool.current).toBe(2);
    expect(s.pool.max).toBe(2);
  });

  it("starting rage when already raging is a no-op", () => {
    let s = createRageState(1);
    s = startRage(s);
    const before = s.pool.current;
    s = startRage(s);
    expect(s.active).toBe(true);
    expect(s.pool.current).toBe(before);
  });

  it("ending rage when not raging is a no-op", () => {
    const s = createRageState(1);
    const result = endRage(s);
    expect(result.active).toBe(false);
    expect(result.pool.current).toBe(s.pool.current);
  });

  it("throws for invalid levels", () => {
    expect(() => rageUsesForLevel(0)).toThrow();
    expect(() => rageUsesForLevel(21)).toThrow();
    expect(() => rageUsesForLevel(1.5)).toThrow();
  });
});

describe("barbarianUnarmoredDefenseAC", () => {
  it("returns 10 + dexMod + conMod", () => {
    expect(barbarianUnarmoredDefenseAC(0, 0)).toBe(10);
    expect(barbarianUnarmoredDefenseAC(3, 2)).toBe(15);
    expect(barbarianUnarmoredDefenseAC(5, 3)).toBe(18);
  });

  it("handles negative modifiers", () => {
    expect(barbarianUnarmoredDefenseAC(-1, -1)).toBe(8);
    expect(barbarianUnarmoredDefenseAC(2, -1)).toBe(11);
  });

  it("handles zero modifiers", () => {
    expect(barbarianUnarmoredDefenseAC(0, 2)).toBe(12);
    expect(barbarianUnarmoredDefenseAC(3, 0)).toBe(13);
  });
});

describe("shouldRageEnd", () => {
  it("returns true if did not attack and did not take damage", () => {
    expect(shouldRageEnd(false, false, false)).toBe(true);
  });

  it("returns false if attacked but did not take damage", () => {
    expect(shouldRageEnd(true, false, false)).toBe(false);
  });

  it("returns false if took damage but did not attack", () => {
    expect(shouldRageEnd(false, true, false)).toBe(false);
  });

  it("returns false if both attacked and took damage", () => {
    expect(shouldRageEnd(true, true, false)).toBe(false);
  });

  it("returns true if unconscious, even if attacked and took damage", () => {
    expect(shouldRageEnd(true, true, true)).toBe(true);
    expect(shouldRageEnd(false, false, true)).toBe(true);
  });

  it("returns true if unconscious and attacked only", () => {
    expect(shouldRageEnd(true, false, true)).toBe(true);
  });
});

describe("isDangerSenseNegated", () => {
  it("returns false with no conditions", () => {
    expect(isDangerSenseNegated([])).toBe(false);
  });

  it("returns true if blinded", () => {
    expect(isDangerSenseNegated(["blinded"])).toBe(true);
  });

  it("returns true if deafened", () => {
    expect(isDangerSenseNegated(["deafened"])).toBe(true);
  });

  it("returns true if incapacitated", () => {
    expect(isDangerSenseNegated(["incapacitated"])).toBe(true);
  });

  it("returns true with mixed negating conditions", () => {
    expect(isDangerSenseNegated(["blinded", "deafened"])).toBe(true);
  });

  it("returns false for non-negating conditions", () => {
    expect(isDangerSenseNegated(["prone", "frightened", "poisoned"])).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(isDangerSenseNegated(["Blinded"])).toBe(true);
    expect(isDangerSenseNegated(["DEAFENED"])).toBe(true);
    expect(isDangerSenseNegated(["Incapacitated"])).toBe(true);
  });
});

describe("rageDamageBonusForLevel", () => {
  it("returns +2 for levels 1-8", () => {
    expect(rageDamageBonusForLevel(1)).toBe(2);
    expect(rageDamageBonusForLevel(8)).toBe(2);
  });

  it("returns +3 for levels 9-15", () => {
    expect(rageDamageBonusForLevel(9)).toBe(3);
    expect(rageDamageBonusForLevel(15)).toBe(3);
  });

  it("returns +4 for levels 16+", () => {
    expect(rageDamageBonusForLevel(16)).toBe(4);
    expect(rageDamageBonusForLevel(20)).toBe(4);
  });
});

describe("Barbarian ClassDefinition", () => {
  it("has correct id, name, and hitDie", () => {
    expect(Barbarian.id).toBe("barbarian");
    expect(Barbarian.name).toBe("Barbarian");
    expect(Barbarian.hitDie).toBe(12);
  });

  it("has STR and CON saving throw proficiencies", () => {
    expect(Barbarian.proficiencies.savingThrows).toEqual(["strength", "constitution"]);
  });

  it("provides rage resource pool at level 1", () => {
    const resources = Barbarian.resourcesAtLevel!(1);
    expect(resources).toHaveLength(1);
    expect(resources[0].name).toBe("rage");
    expect(resources[0].current).toBe(2);
    expect(resources[0].max).toBe(2);
  });

  describe("capabilitiesForLevel", () => {
    it("includes Unarmored Defense and Rage at level 1", () => {
      const caps = Barbarian.capabilitiesForLevel!(1);
      const names = caps.map(c => c.name);
      expect(names).toContain("Unarmored Defense");
      expect(names).toContain("Rage");
      expect(names).not.toContain("Danger Sense");
      expect(names).not.toContain("Reckless Attack");
      expect(names).not.toContain("Extra Attack");
      expect(names).not.toContain("Feral Instinct");
    });

    it("adds Danger Sense and Reckless Attack at level 2", () => {
      const caps = Barbarian.capabilitiesForLevel!(2);
      const names = caps.map(c => c.name);
      expect(names).toContain("Unarmored Defense");
      expect(names).toContain("Rage");
      expect(names).toContain("Danger Sense");
      expect(names).toContain("Reckless Attack");
      expect(names).not.toContain("Extra Attack");
      expect(names).not.toContain("Feral Instinct");
    });

    it("adds Extra Attack at level 5", () => {
      const caps = Barbarian.capabilitiesForLevel!(5);
      const names = caps.map(c => c.name);
      expect(names).toContain("Extra Attack");
      expect(names).not.toContain("Feral Instinct");
    });

    it("adds Feral Instinct at level 7", () => {
      const caps = Barbarian.capabilitiesForLevel!(7);
      const names = caps.map(c => c.name);
      expect(names).toContain("Feral Instinct");
      expect(names).not.toContain("Brutal Strike");
    });

    it("adds Brutal Strike at level 9", () => {
      const caps = Barbarian.capabilitiesForLevel!(9);
      const names = caps.map(c => c.name);
      expect(names).toContain("Brutal Strike");
    });

    it("includes all capabilities at level 20", () => {
      const caps = Barbarian.capabilitiesForLevel!(20);
      const names = caps.map(c => c.name);
      expect(names).toContain("Unarmored Defense");
      expect(names).toContain("Rage");
      expect(names).toContain("Danger Sense");
      expect(names).toContain("Reckless Attack");
      expect(names).toContain("Extra Attack");
      expect(names).toContain("Feral Instinct");
      expect(names).toContain("Brutal Strike");
    });

    it("Rage capability has correct abilityId and resourceCost", () => {
      const caps = Barbarian.capabilitiesForLevel!(1);
      const rage = caps.find(c => c.name === "Rage");
      expect(rage).toBeDefined();
      expect(rage!.abilityId).toBe("class:barbarian:rage");
      expect(rage!.resourceCost).toEqual({ pool: "rage", amount: 1 });
      expect(rage!.economy).toBe("bonusAction");
    });

    it("Reckless Attack capability has correct abilityId", () => {
      const caps = Barbarian.capabilitiesForLevel!(2);
      const reckless = caps.find(c => c.name === "Reckless Attack");
      expect(reckless).toBeDefined();
      expect(reckless!.abilityId).toBe("class:barbarian:reckless-attack");
      expect(reckless!.economy).toBe("free");
    });
  });
});

describe("classHasFeature — Barbarian features", () => {
  describe("rage", () => {
    it("returns true for any Barbarian level", () => {
      expect(classHasFeature("barbarian", RAGE, 1)).toBe(true);
    });

    it("returns false for non-Barbarian", () => {
      expect(classHasFeature("fighter", RAGE, 10)).toBe(false);
    });

    it("is case-insensitive on classId", () => {
      expect(classHasFeature("Barbarian", RAGE, 1)).toBe(true);
      expect(classHasFeature("BARBARIAN", RAGE, 1)).toBe(true);
    });
  });

  describe("danger-sense", () => {
    it("returns true for Barbarian level 2+", () => {
      expect(classHasFeature("barbarian", DANGER_SENSE, 2)).toBe(true);
      expect(classHasFeature("barbarian", DANGER_SENSE, 5)).toBe(true);
    });

    it("returns false for Barbarian level 1", () => {
      expect(classHasFeature("barbarian", DANGER_SENSE, 1)).toBe(false);
    });

    it("returns false for non-Barbarian", () => {
      expect(classHasFeature("fighter", DANGER_SENSE, 10)).toBe(false);
    });
  });

  describe("feral-instinct", () => {
    it("returns true for Barbarian level 7+", () => {
      expect(classHasFeature("barbarian", FERAL_INSTINCT, 7)).toBe(true);
      expect(classHasFeature("barbarian", FERAL_INSTINCT, 10)).toBe(true);
    });

    it("returns false for Barbarian below level 7", () => {
      expect(classHasFeature("barbarian", FERAL_INSTINCT, 6)).toBe(false);
      expect(classHasFeature("barbarian", FERAL_INSTINCT, 1)).toBe(false);
    });

    it("returns false for non-Barbarian", () => {
      expect(classHasFeature("fighter", FERAL_INSTINCT, 10)).toBe(false);
      expect(classHasFeature("monk", FERAL_INSTINCT, 7)).toBe(false);
    });
  });

  describe("reckless-attack", () => {
    it("returns true for Barbarian level 2+", () => {
      expect(classHasFeature("barbarian", RECKLESS_ATTACK, 2)).toBe(true);
    });

    it("returns false for Barbarian level 1", () => {
      expect(classHasFeature("barbarian", RECKLESS_ATTACK, 1)).toBe(false);
    });

    it("returns false for non-Barbarian", () => {
      expect(classHasFeature("fighter", RECKLESS_ATTACK, 5)).toBe(false);
    });
  });

  describe("extra-attack", () => {
    it("returns true for Barbarian level 5+", () => {
      expect(classHasFeature("barbarian", EXTRA_ATTACK, 5)).toBe(true);
    });

    it("returns false for Barbarian below level 5", () => {
      expect(classHasFeature("barbarian", EXTRA_ATTACK, 4)).toBe(false);

  describe("brutal-strike", () => {
    it("returns true for Barbarian level 9+", () => {
      expect(classHasFeature("barbarian", BRUTAL_STRIKE, 9)).toBe(true);
      expect(classHasFeature("barbarian", BRUTAL_STRIKE, 15)).toBe(true);
    });

    it("returns false for Barbarian below level 9", () => {
      expect(classHasFeature("barbarian", BRUTAL_STRIKE, 8)).toBe(false);
      expect(classHasFeature("barbarian", BRUTAL_STRIKE, 1)).toBe(false);
    });

    it("returns false for non-Barbarian", () => {
      expect(classHasFeature("fighter", BRUTAL_STRIKE, 10)).toBe(false);
    });
  });
});

describe("canUseBrutalStrike", () => {
  it("returns true when raging and used reckless attack", () => {
    expect(canUseBrutalStrike(true, true)).toBe(true);
  });

  it("returns false when not raging", () => {
    expect(canUseBrutalStrike(false, true)).toBe(false);
  });

  it("returns false when raging but did not use reckless attack", () => {
    expect(canUseBrutalStrike(true, false)).toBe(false);
  });

  it("returns false when neither raging nor reckless", () => {
    expect(canUseBrutalStrike(false, false)).toBe(false);
  });
});

describe("getBrutalStrikeBonusDice", () => {
  it("returns 1d12 for a greataxe (1d12)", () => {
    expect(getBrutalStrikeBonusDice("1d12")).toBe("1d12");
  });

  it("returns 1d6 for a greatsword (2d6)", () => {
    expect(getBrutalStrikeBonusDice("2d6")).toBe("1d6");
  });

  it("returns 1d8 for a longsword (1d8)", () => {
    expect(getBrutalStrikeBonusDice("1d8")).toBe("1d8");
  });

  it("returns 1d6 fallback for unrecognized dice notation", () => {
    expect(getBrutalStrikeBonusDice("flat5")).toBe("1d6");
  });
    });
  });

  describe("weapon-mastery", () => {
    it("returns true for Barbarian level 1+", () => {
      expect(classHasFeature("barbarian", WEAPON_MASTERY, 1)).toBe(true);
    });
  });
});
