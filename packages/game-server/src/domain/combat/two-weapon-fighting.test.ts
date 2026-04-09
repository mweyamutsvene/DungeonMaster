import { describe, it, expect } from "vitest";
import { canMakeOffhandAttack, computeOffhandDamageModifier } from "./two-weapon-fighting.js";

describe("Two-Weapon Fighting", () => {
  describe("canMakeOffhandAttack", () => {
    it("allows when both weapons have Light property", () => {
      const main = { properties: ["Light", "Finesse"] };
      const off = { properties: ["Light"] };
      expect(canMakeOffhandAttack(main, off)).toBe(true);
    });

    it("rejects when main weapon is not Light", () => {
      const main = { properties: ["Versatile"] };
      const off = { properties: ["Light"] };
      expect(canMakeOffhandAttack(main, off)).toBe(false);
    });

    it("rejects when offhand weapon is not Light", () => {
      const main = { properties: ["Light"] };
      const off = { properties: ["Heavy", "Two-Handed"] };
      expect(canMakeOffhandAttack(main, off)).toBe(false);
    });

    it("rejects when either weapon is null", () => {
      expect(canMakeOffhandAttack(null, { properties: ["Light"] })).toBe(false);
      expect(canMakeOffhandAttack({ properties: ["Light"] }, null)).toBe(false);
    });

    it("rejects when weapons have no properties", () => {
      expect(canMakeOffhandAttack({}, {})).toBe(false);
      expect(canMakeOffhandAttack({ properties: [] }, { properties: [] })).toBe(false);
    });

    it("allows any weapons with Dual Wielder feat", () => {
      const main = { properties: ["Versatile"] };
      const off = { properties: ["Heavy"] };
      expect(canMakeOffhandAttack(main, off, true)).toBe(true);
    });

    it("case-insensitive Light check", () => {
      const main = { properties: ["light"] };
      const off = { properties: ["LIGHT"] };
      expect(canMakeOffhandAttack(main, off)).toBe(true);
    });
  });

  describe("computeOffhandDamageModifier", () => {
    it("returns 0 without Two-Weapon Fighting style", () => {
      expect(computeOffhandDamageModifier(3, false)).toBe(0);
      expect(computeOffhandDamageModifier(5, false)).toBe(0);
    });

    it("returns ability modifier with Two-Weapon Fighting style", () => {
      expect(computeOffhandDamageModifier(3, true)).toBe(3);
      expect(computeOffhandDamageModifier(-1, true)).toBe(-1);
    });
  });
});
