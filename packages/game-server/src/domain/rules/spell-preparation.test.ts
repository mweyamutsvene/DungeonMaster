import { describe, expect, it } from "vitest";

import {
  getSpellCasterType,
  getMaxPreparedSpells,
  isSpellAvailable,
} from "./spell-preparation.js";

describe("Spell Preparation", () => {
  describe("getSpellCasterType", () => {
    it("identifies prepared casters", () => {
      expect(getSpellCasterType("cleric")).toBe("prepared");
      expect(getSpellCasterType("druid")).toBe("prepared");
      expect(getSpellCasterType("paladin")).toBe("prepared");
      expect(getSpellCasterType("wizard")).toBe("prepared");
    });

    it("identifies known casters", () => {
      expect(getSpellCasterType("bard")).toBe("known");
      expect(getSpellCasterType("ranger")).toBe("known");
      expect(getSpellCasterType("sorcerer")).toBe("known");
      expect(getSpellCasterType("warlock")).toBe("known");
    });

    it("identifies non-casters", () => {
      expect(getSpellCasterType("fighter")).toBe("none");
      expect(getSpellCasterType("barbarian")).toBe("none");
      expect(getSpellCasterType("rogue")).toBe("none");
    });

    it("is case insensitive", () => {
      expect(getSpellCasterType("Wizard")).toBe("prepared");
      expect(getSpellCasterType("BARD")).toBe("known");
    });
  });

  describe("getMaxPreparedSpells", () => {
    it("returns ability mod + level for prepared casters", () => {
      // Wizard level 5, INT mod +4 → 5 + 4 = 9
      expect(getMaxPreparedSpells("wizard", 5, 4)).toBe(9);
    });

    it("has minimum of 1", () => {
      // Level 1, mod -1 → max(1, -1 + 1) = max(1, 0) = 1
      expect(getMaxPreparedSpells("cleric", 1, -1)).toBe(1);
    });

    it("returns 0 for non-prepared casters", () => {
      expect(getMaxPreparedSpells("bard", 5, 3)).toBe(0);
      expect(getMaxPreparedSpells("fighter", 10, 2)).toBe(0);
    });

    it("scales with level", () => {
      // Cleric level 10, WIS mod +3 → 10 + 3 = 13
      expect(getMaxPreparedSpells("cleric", 10, 3)).toBe(13);
    });
  });

  describe("isSpellAvailable", () => {
    it("allows any spell when no lists are set (backward compatibility)", () => {
      expect(isSpellAvailable("fireball", undefined, undefined)).toBe(true);
      expect(isSpellAvailable("fireball", [], [])).toBe(true);
    });

    it("checks prepared spells list", () => {
      const prepared = ["fireball", "shield", "magic-missile"];
      expect(isSpellAvailable("fireball", prepared, undefined)).toBe(true);
      expect(isSpellAvailable("thunderwave", prepared, undefined)).toBe(false);
    });

    it("checks known spells list", () => {
      const known = ["eldritch-blast", "hex"];
      expect(isSpellAvailable("hex", undefined, known)).toBe(true);
      expect(isSpellAvailable("fireball", undefined, known)).toBe(false);
    });

    it("checks both lists (either matches)", () => {
      const prepared = ["fireball"];
      const known = ["hex"];
      expect(isSpellAvailable("fireball", prepared, known)).toBe(true);
      expect(isSpellAvailable("hex", prepared, known)).toBe(true);
      expect(isSpellAvailable("shield", prepared, known)).toBe(false);
    });
  });
});
