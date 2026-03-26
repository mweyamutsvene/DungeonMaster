/**
 * Fighting Style — Character Integration Tests
 * 
 * Tests that fighting styles are correctly unified with feat modifiers
 * when accessed through Character entities.
 */
import { describe, it, expect } from "vitest";
import { Character, type CharacterData } from "./character.js";
import { AbilityScores } from "../core/ability-scores.js";
import { FEAT_ARCHERY, FEAT_DEFENSE, FEAT_DUELING, computeFeatModifiers } from "../../rules/feat-modifiers.js";
import { classHasFeature } from "../classes/registry.js";
import { FIGHTING_STYLE } from "../classes/feature-keys.js";

function makeCharacter(overrides: Partial<CharacterData> = {}): Character {
  return new Character({
    id: "test-char",
    name: "Test Fighter",
    maxHP: 30,
    currentHP: 30,
    armorClass: 16,
    speed: 30,
    abilityScores: new AbilityScores({
      strength: 16,
      dexterity: 14,
      constitution: 14,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
    }),
    level: 1,
    characterClass: "Fighter",
    classId: "fighter",
    experiencePoints: 0,
    ...overrides,
  });
}

describe("Character with Fighting Style", () => {
  it("includes fighting style feat ID in getFeatIds()", () => {
    const char = makeCharacter({ fightingStyle: "archery" });
    expect(char.getFeatIds()).toContain(FEAT_ARCHERY);
  });

  it("does not duplicate feat ID if already in featIds", () => {
    const char = makeCharacter({
      fightingStyle: "archery",
      featIds: [FEAT_ARCHERY],
    });
    const ids = char.getFeatIds();
    expect(ids.filter((id) => id === FEAT_ARCHERY)).toHaveLength(1);
  });

  it("returns base feat IDs when no fighting style", () => {
    const char = makeCharacter({ featIds: ["feat_alert"] });
    expect(char.getFeatIds()).toEqual(["feat_alert"]);
  });

  it("getFightingStyle() returns the chosen style", () => {
    const char = makeCharacter({ fightingStyle: "defense" });
    expect(char.getFightingStyle()).toBe("defense");
  });

  it("getFightingStyle() returns undefined when none chosen", () => {
    const char = makeCharacter();
    expect(char.getFightingStyle()).toBeUndefined();
  });

  describe("Defense style AC bonus", () => {
    it("adds +1 AC when wearing armor", () => {
      const char = makeCharacter({
        fightingStyle: "defense",
        armorClass: 16,
        equipment: {
          armor: { name: "Chain Mail", category: "heavy", armorClass: { base: 16, addDexterityModifier: false } },
        },
      });
      expect(char.getAC()).toBe(17); // 16 base + 1 defense
    });

    it("does not add AC when not wearing armor", () => {
      const char = makeCharacter({
        fightingStyle: "defense",
        armorClass: 12,
      });
      // No armor equipped, so Defense doesn't apply
      // However, for non-barbarian/monk without unarmored defense, getAC returns base
      expect(char.getAC()).toBe(12);
    });
  });

  describe("Archery style through feat modifiers", () => {
    it("gives +2 ranged attack bonus via computeFeatModifiers", () => {
      const char = makeCharacter({ fightingStyle: "archery" });
      const mods = computeFeatModifiers(char.getFeatIds());
      expect(mods.rangedAttackBonus).toBe(2);
    });
  });

  describe("Dueling style through feat modifiers", () => {
    it("gives +2 damage bonus via computeFeatModifiers", () => {
      const char = makeCharacter({ fightingStyle: "dueling" });
      const mods = computeFeatModifiers(char.getFeatIds());
      expect(mods.duelingDamageBonus).toBe(2);
    });
  });
});

describe("Class feature gates for fighting-style", () => {
  it("Fighter gets fighting-style at level 1", () => {
    expect(classHasFeature("fighter", FIGHTING_STYLE, 1)).toBe(true);
  });

  it("Paladin gets fighting-style at level 2", () => {
    expect(classHasFeature("paladin", FIGHTING_STYLE, 2)).toBe(true);
    expect(classHasFeature("paladin", FIGHTING_STYLE, 1)).toBe(false);
  });

  it("Ranger gets fighting-style at level 2", () => {
    expect(classHasFeature("ranger", FIGHTING_STYLE, 2)).toBe(true);
    expect(classHasFeature("ranger", FIGHTING_STYLE, 1)).toBe(false);
  });

  it("Rogue does not get fighting-style", () => {
    expect(classHasFeature("rogue", FIGHTING_STYLE, 20)).toBe(false);
  });

  it("Wizard does not get fighting-style", () => {
    expect(classHasFeature("wizard", FIGHTING_STYLE, 20)).toBe(false);
  });
});
