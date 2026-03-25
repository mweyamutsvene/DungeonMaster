import { describe, expect, it } from "vitest";
import { getSpellSlots, getCantripsKnown, getPactSlotLevel, getCasterType } from "./spell-progression.js";

describe("spell-progression", () => {
  describe("getSpellSlots — full casters", () => {
    it("Wizard level 1: 2 first-level slots", () => {
      expect(getSpellSlots("wizard", 1)).toEqual({ 1: 2 });
    });

    it("Cleric level 3: 4 first-level + 2 second-level", () => {
      expect(getSpellSlots("cleric", 3)).toEqual({ 1: 4, 2: 2 });
    });

    it("Bard level 5: 4/3/2", () => {
      const slots = getSpellSlots("bard", 5);
      expect(slots[1]).toBe(4);
      expect(slots[2]).toBe(3);
      expect(slots[3]).toBe(2);
    });

    it("Sorcerer level 9: includes 5th-level slots", () => {
      const slots = getSpellSlots("sorcerer", 9);
      expect(slots[5]).toBe(1);
    });

    it("Druid level 17: has 9th-level slot", () => {
      const slots = getSpellSlots("druid", 17);
      expect(slots[9]).toBe(1);
    });

    it("Wizard level 20: full progression", () => {
      const slots = getSpellSlots("wizard", 20);
      expect(slots).toEqual({ 1: 4, 2: 3, 3: 3, 4: 3, 5: 3, 6: 2, 7: 2, 8: 1, 9: 1 });
    });
  });

  describe("getSpellSlots — half casters", () => {
    it("Paladin level 1: no slots", () => {
      expect(getSpellSlots("paladin", 1)).toEqual({});
    });

    it("Paladin level 2: 2 first-level slots", () => {
      expect(getSpellSlots("paladin", 2)).toEqual({ 1: 2 });
    });

    it("Ranger level 5: 4/2 slots", () => {
      const slots = getSpellSlots("ranger", 5);
      expect(slots[1]).toBe(4);
      expect(slots[2]).toBe(2);
    });

    it("Paladin level 9: has 3rd-level", () => {
      expect(getSpellSlots("paladin", 9)[3]).toBe(2);
    });

    it("Ranger level 17: up to 5th-level slots", () => {
      const slots = getSpellSlots("ranger", 17);
      expect(slots[5]).toBe(1);
      expect(slots[6]).toBeUndefined();
    });
  });

  describe("getSpellSlots — Warlock Pact Magic", () => {
    it("Warlock level 1: 1 first-level slot", () => {
      expect(getSpellSlots("warlock", 1)).toEqual({ 1: 1 });
    });

    it("Warlock level 2: 2 first-level slots", () => {
      expect(getSpellSlots("warlock", 2)).toEqual({ 1: 2 });
    });

    it("Warlock level 5: 2 third-level slots", () => {
      expect(getSpellSlots("warlock", 5)).toEqual({ 3: 2 });
    });

    it("Warlock level 9: 2 fifth-level slots", () => {
      expect(getSpellSlots("warlock", 9)).toEqual({ 5: 2 });
    });

    it("Warlock level 11: 3 fifth-level slots", () => {
      expect(getSpellSlots("warlock", 11)).toEqual({ 5: 3 });
    });

    it("Warlock level 17: 4 fifth-level slots", () => {
      expect(getSpellSlots("warlock", 17)).toEqual({ 5: 4 });
    });
  });

  describe("getSpellSlots — non-casters", () => {
    it("Fighter returns empty", () => {
      expect(getSpellSlots("fighter", 10)).toEqual({});
    });

    it("Barbarian returns empty", () => {
      expect(getSpellSlots("barbarian", 5)).toEqual({});
    });

    it("Monk returns empty", () => {
      expect(getSpellSlots("monk", 10)).toEqual({});
    });

    it("Rogue returns empty", () => {
      expect(getSpellSlots("rogue", 7)).toEqual({});
    });
  });

  describe("getCantripsKnown", () => {
    it("Wizard level 1: 3 cantrips", () => {
      expect(getCantripsKnown("wizard", 1)).toBe(3);
    });

    it("Cleric level 4: 4 cantrips", () => {
      expect(getCantripsKnown("cleric", 4)).toBe(4);
    });

    it("Warlock level 1: 2 cantrips", () => {
      expect(getCantripsKnown("warlock", 1)).toBe(2);
    });

    it("Warlock level 10: 4 cantrips", () => {
      expect(getCantripsKnown("warlock", 10)).toBe(4);
    });

    it("Fighter: 0 cantrips", () => {
      expect(getCantripsKnown("fighter", 5)).toBe(0);
    });

    it("Paladin: 0 cantrips (half casters)", () => {
      expect(getCantripsKnown("paladin", 5)).toBe(0);
    });
  });

  describe("getPactSlotLevel", () => {
    it("level 1: slot level 1", () => {
      expect(getPactSlotLevel(1)).toBe(1);
    });

    it("level 5: slot level 3", () => {
      expect(getPactSlotLevel(5)).toBe(3);
    });

    it("level 9+: slot level 5", () => {
      expect(getPactSlotLevel(9)).toBe(5);
      expect(getPactSlotLevel(20)).toBe(5);
    });
  });

  describe("getCasterType", () => {
    it("full casters", () => {
      expect(getCasterType("wizard")).toBe("full");
      expect(getCasterType("cleric")).toBe("full");
      expect(getCasterType("bard")).toBe("full");
      expect(getCasterType("druid")).toBe("full");
      expect(getCasterType("sorcerer")).toBe("full");
    });

    it("half casters", () => {
      expect(getCasterType("paladin")).toBe("half");
      expect(getCasterType("ranger")).toBe("half");
    });

    it("pact casters", () => {
      expect(getCasterType("warlock")).toBe("pact");
    });

    it("non-casters", () => {
      expect(getCasterType("fighter")).toBe("none");
      expect(getCasterType("barbarian")).toBe("none");
      expect(getCasterType("monk")).toBe("none");
      expect(getCasterType("rogue")).toBe("none");
    });
  });

  describe("edge cases", () => {
    it("clamps level below 1 to 1", () => {
      expect(getSpellSlots("wizard", 0)).toEqual({ 1: 2 });
      expect(getSpellSlots("wizard", -5)).toEqual({ 1: 2 });
    });

    it("clamps level above 20 to 20", () => {
      expect(getSpellSlots("wizard", 25)).toEqual(getSpellSlots("wizard", 20));
    });
  });
});
