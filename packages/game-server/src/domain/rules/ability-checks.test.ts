import { describe, expect, it } from "vitest";

import { FixedDiceRoller } from "./dice-roller.js";
import { abilityCheck, abilityCheckForCreature, skillCheck } from "./ability-checks.js";
import { AbilityScores } from "../entities/core/ability-scores.js";
import { Character } from "../entities/creatures/character.js";

describe("ability-checks", () => {
  it("abilityCheck applies proficiency when proficient", () => {
    const dice = new FixedDiceRoller(10);

    const r = abilityCheck(dice, {
      dc: 15,
      abilityModifier: 2,
      proficiencyBonus: 3,
      proficient: true,
    });

    // 10 + 2 + 3
    expect(r.total).toBe(15);
    expect(r.success).toBe(true);
  });

  it("abilityCheck doubles proficiency bonus with expertise", () => {
    const dice = new FixedDiceRoller(10);

    const r = abilityCheck(dice, {
      dc: 18,
      abilityModifier: 2,
      proficiencyBonus: 3,
      proficient: true,
      expertise: true,
    });

    // 10 + 2 + (3 * 2) = 18
    expect(r.total).toBe(18);
    expect(r.success).toBe(true);
  });

  it("abilityCheck ignores expertise when not proficient", () => {
    const dice = new FixedDiceRoller(10);

    const r = abilityCheck(dice, {
      dc: 13,
      abilityModifier: 2,
      proficiencyBonus: 3,
      proficient: false,
      expertise: true,
    });

    // 10 + 2 + 0 (expertise ignored without proficiency)
    expect(r.total).toBe(12);
    expect(r.success).toBe(false);
  });

  it("skillCheck resolves governing ability", () => {
    const dice = new FixedDiceRoller(8);

    const r = skillCheck(dice, {
      dc: 10,
      skill: "stealth",
      abilityModifiers: {
        strength: 0,
        dexterity: 2,
        constitution: 0,
        intelligence: 0,
        wisdom: 0,
        charisma: 0,
      },
      proficiencyBonus: 2,
      proficient: false,
    });

    // 8 + dex(2)
    expect(r.total).toBe(10);
    expect(r.success).toBe(true);
  });

  it("halfProficiency adds floor(proficiencyBonus / 2) when not proficient", () => {
    const dice = new FixedDiceRoller(10);

    const r = abilityCheck(dice, {
      dc: 15,
      abilityModifier: 2,
      proficiencyBonus: 3,
      proficient: false,
      halfProficiency: true,
    });

    // 10 + 2 + floor(3/2)=1 = 13
    expect(r.total).toBe(13);
    expect(r.success).toBe(false);
  });

  it("halfProficiency with even proficiency bonus", () => {
    const dice = new FixedDiceRoller(10);

    const r = abilityCheck(dice, {
      dc: 15,
      abilityModifier: 2,
      proficiencyBonus: 4,
      proficient: false,
      halfProficiency: true,
    });

    // 10 + 2 + floor(4/2)=2 = 14
    expect(r.total).toBe(14);
  });

  it("proficient overrides halfProficiency (full proficiency wins)", () => {
    const dice = new FixedDiceRoller(10);

    const r = abilityCheck(dice, {
      dc: 15,
      abilityModifier: 2,
      proficiencyBonus: 3,
      proficient: true,
      halfProficiency: true,
    });

    // 10 + 2 + 3 (full proficiency, not half) = 15
    expect(r.total).toBe(15);
    expect(r.success).toBe(true);
  });

  it("applies disadvantage on STR/DEX d20 tests when wearing untrained armor", () => {
    // FixedDiceRoller returns the same d20 each call; with disadvantage we still expect 2 rolls.
    const dice = new FixedDiceRoller(12);

    const c = new Character({
      id: "pen1",
      name: "Untrained",
      maxHP: 10,
      currentHP: 10,
      armorClass: 10,
      speed: 30,
      abilityScores: new AbilityScores({
        strength: 10,
        dexterity: 10,
        constitution: 10,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
      }),
      level: 1,
      characterClass: "wizard",
      classId: "wizard",
      experiencePoints: 0,
      armorTraining: { medium: false },
      equipment: {
        armor: {
          name: "Chain Shirt",
          category: "medium",
          armorClass: { base: 13, addDexterityModifier: true, dexterityModifierMax: 2 },
        },
      },
    });

    const r = abilityCheckForCreature(dice, c, {
      dc: 10,
      ability: "strength",
      abilityModifier: 0,
    });

    expect(r.mode).toBe("disadvantage");
    expect(r.rolls).toHaveLength(2);
  });
});
