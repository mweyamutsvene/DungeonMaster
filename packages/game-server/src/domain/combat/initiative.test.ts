import { describe, expect, it } from "vitest";

import { AbilityScores } from "../entities/core/ability-scores.js";
import { Character } from "../entities/creatures/character.js";
import { FixedDiceRoller } from "../rules/dice-roller.js";
import { rollInitiative } from "./initiative.js";

function makeCharacter(params: { id: string; dex: number; featIds?: readonly string[] }): Character {
  return new Character({
    id: params.id,
    name: params.id,
    maxHP: 10,
    currentHP: 10,
    armorClass: 10,
    speed: 30,
    abilityScores: new AbilityScores({
      strength: 10,
      dexterity: params.dex,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
    }),
    level: 1,
    characterClass: "Fighter",
    classId: "fighter",
    experiencePoints: 0,
    featIds: params.featIds,
  });
}

describe("rollInitiative (feats)", () => {
  it("adds proficiency bonus to initiative when character has Alert", () => {
    const dice = new FixedDiceRoller(10);
    const c1 = makeCharacter({ id: "a", dex: 10, featIds: ["feat_alert"] });
    const c2 = makeCharacter({ id: "b", dex: 10 });

    const entries = rollInitiative(dice, [c1, c2]);
    const byId = new Map(entries.map((e) => [e.creature.getId(), e.initiative] as const));

    // Fixed d20=10, dex mod=0, proficiency bonus at level 1 = 2.
    expect(byId.get("a")).toBe(12);
    expect(byId.get("b")).toBe(10);
  });
});
