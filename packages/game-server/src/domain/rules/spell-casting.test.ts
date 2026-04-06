import { describe, it, expect } from "vitest";
import {
  getSpellcastingModifier,
  computeSpellSaveDC,
  computeSpellAttackBonus,
} from "./spell-casting.js";

describe("getSpellcastingModifier", () => {
  it("computes modifier from spellcastingAbility + abilityScores", () => {
    expect(
      getSpellcastingModifier({
        spellcastingAbility: "intelligence",
        abilityScores: { intelligence: 16 },
      }),
    ).toBe(3);
  });

  it("returns 0 when spellcastingAbility is missing", () => {
    expect(getSpellcastingModifier({ abilityScores: { intelligence: 16 } })).toBe(0);
  });

  it("returns 0 for null sheet", () => {
    expect(getSpellcastingModifier(null)).toBe(0);
  });

  it("returns 0 for undefined sheet", () => {
    expect(getSpellcastingModifier(undefined)).toBe(0);
  });

  it("defaults to score 10 (mod 0) when ability score is missing", () => {
    expect(
      getSpellcastingModifier({ spellcastingAbility: "wisdom", abilityScores: {} }),
    ).toBe(0);
  });

  it("handles negative modifiers", () => {
    expect(
      getSpellcastingModifier({
        spellcastingAbility: "charisma",
        abilityScores: { charisma: 8 },
      }),
    ).toBe(-1);
  });
});

describe("computeSpellSaveDC", () => {
  it("returns explicit spellSaveDC when set (monster stat blocks)", () => {
    expect(computeSpellSaveDC({ spellSaveDC: 15 })).toBe(15);
  });

  it("computes from ability scores + proficiency bonus", () => {
    // 8 + 2 (prof) + 3 (INT 16 mod) = 13
    expect(
      computeSpellSaveDC({
        spellcastingAbility: "intelligence",
        abilityScores: { intelligence: 16 },
        proficiencyBonus: 2,
      }),
    ).toBe(13);
  });

  it("derives proficiency bonus from level when not explicitly set", () => {
    // Level 5 → prof 3; 8 + 3 + 4 (INT 18) = 15
    expect(
      computeSpellSaveDC({
        spellcastingAbility: "intelligence",
        abilityScores: { intelligence: 18 },
        level: 5,
      }),
    ).toBe(15);
  });

  it("falls back to 13 when no spellcastingAbility is set", () => {
    expect(computeSpellSaveDC({ abilityScores: { intelligence: 20 }, level: 10 })).toBe(13);
  });

  it("falls back to 13 for null sheet", () => {
    expect(computeSpellSaveDC(null)).toBe(13);
  });

  it("falls back to 13 for undefined sheet", () => {
    expect(computeSpellSaveDC(undefined)).toBe(13);
  });

  it("uses default prof bonus 2 when neither proficiencyBonus nor level is set", () => {
    // 8 + 2 + 3 (WIS 16) = 13
    expect(
      computeSpellSaveDC({
        spellcastingAbility: "wisdom",
        abilityScores: { wisdom: 16 },
      }),
    ).toBe(13);
  });

  it("prefers explicit spellSaveDC over computed value", () => {
    expect(
      computeSpellSaveDC({
        spellSaveDC: 18,
        spellcastingAbility: "intelligence",
        abilityScores: { intelligence: 10 },
        proficiencyBonus: 2,
      }),
    ).toBe(18);
  });
});

describe("computeSpellAttackBonus", () => {
  it("returns explicit spellAttackBonus when set", () => {
    expect(computeSpellAttackBonus({ spellAttackBonus: 7 })).toBe(7);
  });

  it("computes from ability scores + proficiency bonus", () => {
    // 2 (prof) + 3 (INT 16 mod) = 5
    expect(
      computeSpellAttackBonus({
        spellcastingAbility: "intelligence",
        abilityScores: { intelligence: 16 },
        proficiencyBonus: 2,
      }),
    ).toBe(5);
  });

  it("derives proficiency bonus from level when not explicitly set", () => {
    // Level 9 → prof 4; 4 + 5 (CHA 20) = 9
    expect(
      computeSpellAttackBonus({
        spellcastingAbility: "charisma",
        abilityScores: { charisma: 20 },
        level: 9,
      }),
    ).toBe(9);
  });

  it("falls back to 5 when no spellcastingAbility is set", () => {
    expect(computeSpellAttackBonus({ abilityScores: { intelligence: 20 }, level: 10 })).toBe(5);
  });

  it("falls back to 5 for null sheet", () => {
    expect(computeSpellAttackBonus(null)).toBe(5);
  });

  it("falls back to 5 for undefined sheet", () => {
    expect(computeSpellAttackBonus(undefined)).toBe(5);
  });

  it("prefers explicit spellAttackBonus over computed value", () => {
    expect(
      computeSpellAttackBonus({
        spellAttackBonus: 10,
        spellcastingAbility: "intelligence",
        abilityScores: { intelligence: 10 },
        proficiencyBonus: 2,
      }),
    ).toBe(10);
  });
});
