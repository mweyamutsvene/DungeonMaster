import { describe, expect, it } from "vitest";

import { Character, type CharacterData } from "./character.js";
import { AbilityScores } from "../core/ability-scores.js";

function makeCharacter(overrides: Partial<CharacterData> = {}): Character {
  return new Character({
    id: "char-1",
    name: "Test Hero",
    maxHP: 40,
    currentHP: 40,
    armorClass: 15,
    speed: 30,
    abilityScores: new AbilityScores({
      strength: 16,
      dexterity: 14,
      constitution: 12,
      intelligence: 10,
      wisdom: 13,
      charisma: 8,
    }),
    level: 5,
    characterClass: "Fighter",
    classId: "fighter",
    experiencePoints: 0,
    ...overrides,
  });
}

describe("Character - EM-M2/M3/M4 fields", () => {
  describe("ASI (EM-M2)", () => {
    it("returns empty ASI choices by default", () => {
      const c = makeCharacter();
      expect(c.getASIChoices()).toEqual([]);
    });

    it("returns stored ASI choices", () => {
      const choices = [{ level: 4, type: "asi" as const, scores: { strength: 2 } }];
      const c = makeCharacter({ asiChoices: choices });
      expect(c.getASIChoices()).toEqual(choices);
    });

    it("computes effective ability scores with ASI", () => {
      const choices = [{ level: 4, type: "asi" as const, scores: { strength: 2 } }];
      const c = makeCharacter({ asiChoices: choices });
      const effective = c.getEffectiveAbilityScores();
      expect(effective.strength).toBe(18); // 16 + 2
      expect(effective.dexterity).toBe(14); // unchanged
    });

    it("ignores ASI choices above character level", () => {
      const choices = [{ level: 8, type: "asi" as const, scores: { strength: 2 } }];
      const c = makeCharacter({ asiChoices: choices, level: 5 });
      const effective = c.getEffectiveAbilityScores();
      expect(effective.strength).toBe(16); // unchanged, level 5 < ASI level 8
    });

    it("includes feat IDs from ASI feat choices in getAllFeatIds", () => {
      const choices = [{ level: 4, type: "feat" as const, featId: "feat_tough" }];
      const c = makeCharacter({ asiChoices: choices, featIds: ["feat_alert"] });
      expect(c.getAllFeatIds()).toContain("feat_alert");
      expect(c.getAllFeatIds()).toContain("feat_tough");
    });
  });

  describe("Skill Proficiencies (EM-M3)", () => {
    it("returns empty arrays by default", () => {
      const c = makeCharacter();
      expect(c.getSkillProficiencies()).toEqual([]);
      expect(c.getSkillExpertise()).toEqual([]);
    });

    it("stores skill proficiencies", () => {
      const c = makeCharacter({ skillProficiencies: ["athletics", "perception"] });
      expect(c.getSkillProficiencies()).toEqual(["athletics", "perception"]);
    });

    it("computes skill modifier without proficiency", () => {
      const c = makeCharacter();
      // Athletics → STR (+3), no proficiency
      expect(c.getSkillModifier("athletics")).toBe(3);
    });

    it("computes skill modifier with proficiency", () => {
      const c = makeCharacter({ skillProficiencies: ["athletics"] });
      // Athletics → STR (+3) + prof bonus (3 at level 5) = 6
      expect(c.getSkillModifier("athletics")).toBe(6);
    });

    it("computes skill modifier with expertise", () => {
      const c = makeCharacter({
        skillProficiencies: ["stealth"],
        skillExpertise: ["stealth"],
      });
      // Stealth → DEX (+2) + expertise (3×2=6) = 8
      expect(c.getSkillModifier("stealth")).toBe(8);
    });
  });

  describe("Spell Preparation (EM-M4)", () => {
    it("returns empty arrays by default", () => {
      const c = makeCharacter();
      expect(c.getPreparedSpells()).toEqual([]);
      expect(c.getKnownSpells()).toEqual([]);
    });

    it("stores prepared spells", () => {
      const c = makeCharacter({ preparedSpells: ["fireball", "shield"] });
      expect(c.getPreparedSpells()).toEqual(["fireball", "shield"]);
    });

    it("stores known spells", () => {
      const c = makeCharacter({ knownSpells: ["eldritch-blast", "hex"] });
      expect(c.getKnownSpells()).toEqual(["eldritch-blast", "hex"]);
    });
  });

  describe("toJSON includes new fields", () => {
    it("includes ASI choices when present", () => {
      const choices = [{ level: 4, type: "asi" as const, scores: { strength: 2 } }];
      const c = makeCharacter({ asiChoices: choices });
      const json = c.toJSON();
      expect(json.asiChoices).toEqual(choices);
    });

    it("omits empty arrays from JSON", () => {
      const c = makeCharacter();
      const json = c.toJSON();
      expect(json).not.toHaveProperty("asiChoices");
      expect(json).not.toHaveProperty("skillProficiencies");
      expect(json).not.toHaveProperty("preparedSpells");
    });

    it("includes all non-empty fields", () => {
      const c = makeCharacter({
        skillProficiencies: ["athletics"],
        skillExpertise: ["athletics"],
        preparedSpells: ["fireball"],
        knownSpells: ["hex"],
      });
      const json = c.toJSON();
      expect(json.skillProficiencies).toEqual(["athletics"]);
      expect(json.skillExpertise).toEqual(["athletics"]);
      expect(json.preparedSpells).toEqual(["fireball"]);
      expect(json.knownSpells).toEqual(["hex"]);
    });
  });
});
