import { describe, it, expect } from "vitest";
import {
  getWeaponMastery,
  hasWeaponMasteryFeature,
  getWeaponMasteryCount,
  hasWeaponMastery,
  resolveWeaponMastery,
  isWeaponMasteryProperty,
  WEAPON_MASTERY_MAP,
  type WeaponMasterySheet,
} from "./weapon-mastery.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSheet(overrides: Partial<WeaponMasterySheet> = {}): WeaponMasterySheet {
  return { className: "fighter", ...overrides };
}

// ---------------------------------------------------------------------------
// getWeaponMastery
// ---------------------------------------------------------------------------

describe("getWeaponMastery", () => {
  it.each([
    ["club", "slow"],
    ["dagger", "nick"],
    ["greatclub", "push"],
    ["handaxe", "vex"],
    ["javelin", "slow"],
    ["light hammer", "nick"],
    ["mace", "sap"],
    ["quarterstaff", "topple"],
    ["greataxe", "cleave"],
    ["greatsword", "graze"],
    ["rapier", "vex"],
    ["scimitar", "nick"],
    ["shortsword", "vex"],
    ["longbow", "slow"],
    ["heavy crossbow", "push"],
    ["hand crossbow", "vex"],
  ] as const)("returns '%s' → '%s'", (weapon, expected) => {
    expect(getWeaponMastery(weapon)).toBe(expected);
  });

  it("is case-insensitive", () => {
    expect(getWeaponMastery("Greataxe")).toBe("cleave");
    expect(getWeaponMastery("LONGSWORD")).toBe("sap");
  });

  it("returns undefined for unknown weapon", () => {
    expect(getWeaponMastery("banana")).toBeUndefined();
  });

  it("covers all 8 mastery types in the map", () => {
    const allProperties = new Set(Object.values(WEAPON_MASTERY_MAP));
    expect(allProperties).toEqual(
      new Set(["cleave", "graze", "nick", "push", "sap", "slow", "topple", "vex"]),
    );
  });
});

// ---------------------------------------------------------------------------
// hasWeaponMasteryFeature
// ---------------------------------------------------------------------------

describe("hasWeaponMasteryFeature", () => {
  it.each(["Fighter", "Barbarian", "Paladin", "Ranger", "Rogue"])(
    "returns true for %s (case-insensitive)",
    (cls) => {
      expect(hasWeaponMasteryFeature(makeSheet({ className: cls }))).toBe(true);
      expect(hasWeaponMasteryFeature(makeSheet({ className: cls.toLowerCase() }))).toBe(true);
      expect(hasWeaponMasteryFeature(makeSheet({ className: cls.toUpperCase() }))).toBe(true);
    },
  );

  it("returns false for classes without Weapon Mastery", () => {
    expect(hasWeaponMasteryFeature(makeSheet({ className: "wizard" }))).toBe(false);
    expect(hasWeaponMasteryFeature(makeSheet({ className: "monk" }))).toBe(false);
    expect(hasWeaponMasteryFeature(makeSheet({ className: "cleric" }))).toBe(false);
    expect(hasWeaponMasteryFeature(makeSheet({ className: "warlock" }))).toBe(false);
  });

  it("returns false when className is empty / missing", () => {
    expect(hasWeaponMasteryFeature({})).toBe(false);
    expect(hasWeaponMasteryFeature(makeSheet({ className: "" }))).toBe(false);
  });

  it("uses className override parameter", () => {
    // Sheet says wizard, but override says fighter
    expect(hasWeaponMasteryFeature(makeSheet({ className: "wizard" }), "fighter")).toBe(true);
  });

  it("falls back to sheet.class when className is absent", () => {
    expect(hasWeaponMasteryFeature({ class: "barbarian" })).toBe(true);
    expect(hasWeaponMasteryFeature({ class: "wizard" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getWeaponMasteryCount
// ---------------------------------------------------------------------------

describe("getWeaponMasteryCount", () => {
  it("returns 3 for Fighter", () => {
    expect(getWeaponMasteryCount(makeSheet({ className: "fighter" }))).toBe(3);
  });

  it.each([
    ["barbarian", 2],
    ["paladin", 2],
    ["ranger", 2],
    ["rogue", 2],
  ] as const)("returns %i for %s", (cls, count) => {
    expect(getWeaponMasteryCount(makeSheet({ className: cls }))).toBe(count);
  });

  it("returns 0 for classes without Weapon Mastery", () => {
    expect(getWeaponMasteryCount(makeSheet({ className: "wizard" }))).toBe(0);
  });

  it("returns 0 for empty sheet", () => {
    expect(getWeaponMasteryCount({})).toBe(0);
  });

  it("uses className override parameter", () => {
    expect(getWeaponMasteryCount(makeSheet({ className: "wizard" }), "fighter")).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// hasWeaponMastery
// ---------------------------------------------------------------------------

describe("hasWeaponMastery", () => {
  describe("explicit weaponMasteries list", () => {
    it("returns true when weapon is in the list (case-insensitive)", () => {
      const sheet = makeSheet({ weaponMasteries: ["Longsword", "Greataxe", "Handaxe"] });
      expect(hasWeaponMastery(sheet, "longsword")).toBe(true);
      expect(hasWeaponMastery(sheet, "GREATAXE")).toBe(true);
    });

    it("returns false when weapon is not in the list", () => {
      const sheet = makeSheet({ weaponMasteries: ["Longsword"] });
      expect(hasWeaponMastery(sheet, "rapier")).toBe(false);
    });

    it("returns false for empty weaponMasteries array", () => {
      const sheet = makeSheet({ weaponMasteries: [] });
      expect(hasWeaponMastery(sheet, "longsword")).toBe(false);
    });
  });

  describe("fallback (no explicit list)", () => {
    it("returns true for any weapon if class has Weapon Mastery", () => {
      const sheet = makeSheet({ className: "fighter" });
      expect(hasWeaponMastery(sheet, "longsword")).toBe(true);
      expect(hasWeaponMastery(sheet, "dagger")).toBe(true);
    });

    it("returns false if class does not have Weapon Mastery", () => {
      const sheet = makeSheet({ className: "wizard" });
      expect(hasWeaponMastery(sheet, "quarterstaff")).toBe(false);
    });
  });

  it("uses className override parameter", () => {
    const sheet = makeSheet({ className: "wizard" });
    expect(hasWeaponMastery(sheet, "longsword", "fighter")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveWeaponMastery
// ---------------------------------------------------------------------------

describe("resolveWeaponMastery", () => {
  it("returns mastery property from standard map for eligible character", () => {
    const sheet = makeSheet({ className: "fighter" });
    expect(resolveWeaponMastery("longsword", sheet)).toBe("sap");
    expect(resolveWeaponMastery("greataxe", sheet)).toBe("cleave");
  });

  it("returns undefined when character does not have mastery", () => {
    const sheet = makeSheet({ className: "wizard" });
    expect(resolveWeaponMastery("longsword", sheet)).toBeUndefined();
  });

  it("returns undefined when weapon has no mastery property", () => {
    const sheet = makeSheet({ className: "fighter" });
    expect(resolveWeaponMastery("banana", sheet)).toBeUndefined();
  });

  it("uses explicit mastery override when provided", () => {
    const sheet = makeSheet({ className: "fighter" });
    expect(resolveWeaponMastery("longsword", sheet, undefined, "topple")).toBe("topple");
  });

  it("ignores invalid explicit mastery and falls back to map", () => {
    const sheet = makeSheet({ className: "fighter" });
    expect(resolveWeaponMastery("longsword", sheet, undefined, "invalid")).toBe("sap");
  });

  it("explicit mastery is case-insensitive", () => {
    const sheet = makeSheet({ className: "fighter" });
    expect(resolveWeaponMastery("longsword", sheet, undefined, "TOPPLE")).toBe("topple");
  });

  it("uses className override parameter", () => {
    // Sheet says wizard, but override says fighter → should find mastery
    expect(resolveWeaponMastery("longsword", makeSheet({ className: "wizard" }), "fighter")).toBe(
      "sap",
    );
  });
});

// ---------------------------------------------------------------------------
// isWeaponMasteryProperty
// ---------------------------------------------------------------------------

describe("isWeaponMasteryProperty", () => {
  it.each(["cleave", "graze", "nick", "push", "sap", "slow", "topple", "vex"])(
    "returns true for '%s'",
    (prop) => {
      expect(isWeaponMasteryProperty(prop)).toBe(true);
    },
  );

  it("returns false for unknown values", () => {
    expect(isWeaponMasteryProperty("smash")).toBe(false);
    expect(isWeaponMasteryProperty("")).toBe(false);
    expect(isWeaponMasteryProperty("Cleave")).toBe(false); // case-sensitive
  });
});
