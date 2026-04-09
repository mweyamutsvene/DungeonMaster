import { describe, expect, it } from "vitest";

import { computeSkillModifier, isSkill, ALL_SKILLS } from "./skills.js";

describe("Skills", () => {
  describe("isSkill", () => {
    it("returns true for valid skills", () => {
      expect(isSkill("athletics")).toBe(true);
      expect(isSkill("stealth")).toBe(true);
      expect(isSkill("perception")).toBe(true);
    });

    it("returns false for invalid strings", () => {
      expect(isSkill("swordsmanship")).toBe(false);
      expect(isSkill("")).toBe(false);
    });
  });

  describe("ALL_SKILLS", () => {
    it("contains all 18 standard D&D skills", () => {
      expect(ALL_SKILLS).toHaveLength(18);
    });
  });

  describe("computeSkillModifier", () => {
    const scores = {
      strength: 16,   // +3
      dexterity: 14,  // +2
      constitution: 12, // +1
      intelligence: 10, // +0
      wisdom: 8,       // -1
      charisma: 15,    // +2
    };
    const profBonus = 3;

    it("returns ability modifier alone for non-proficient skill", () => {
      // Athletics → STR (+3), not proficient
      expect(computeSkillModifier(scores, "athletics", profBonus, [], [])).toBe(3);
    });

    it("adds proficiency bonus for proficient skill", () => {
      // Athletics → STR (+3) + proficiency (3) = 6
      expect(computeSkillModifier(scores, "athletics", profBonus, ["athletics"], [])).toBe(6);
    });

    it("doubles proficiency for expertise", () => {
      // Stealth → DEX (+2) + expertise (3×2=6) = 8
      expect(computeSkillModifier(scores, "stealth", profBonus, ["stealth"], ["stealth"])).toBe(8);
    });

    it("expertise without proficiency still applies double", () => {
      // Edge case: expertise implicitly grants proficiency-like bonus
      // But per our logic expertise is checked first
      expect(computeSkillModifier(scores, "stealth", profBonus, [], ["stealth"])).toBe(8);
    });

    it("handles negative ability modifiers", () => {
      // Perception → WIS (-1), proficient: -1 + 3 = 2
      expect(computeSkillModifier(scores, "perception", profBonus, ["perception"], [])).toBe(2);
    });

    it("handles missing ability score (defaults to 10 → +0)", () => {
      expect(computeSkillModifier({}, "athletics", 2, [], [])).toBe(0);
    });
  });
});
