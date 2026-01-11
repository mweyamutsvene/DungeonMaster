import { describe, expect, it } from "vitest";

import { AbilityScores } from "../core/ability-scores.js";
import { FixedDiceRoller } from "../../rules/dice-roller.js";
import { NPC } from "./npc.js";

describe("Creature", () => {
  it("tracks HP and conditions", () => {
    const npc = new NPC({
      id: "c1",
      name: "Test",
      maxHP: 10,
      currentHP: 10,
      armorClass: 12,
      speed: 30,
      abilityScores: new AbilityScores({
        strength: 10,
        dexterity: 14,
        constitution: 10,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
      }),
      role: "guard",
      proficiencyBonus: 2,
    });

    npc.takeDamage(3);
    expect(npc.getCurrentHP()).toBe(7);

    npc.heal(100);
    expect(npc.getCurrentHP()).toBe(10);

    npc.addCondition("PrOnE");
    expect(npc.hasCondition("prone")).toBe(true);
    expect(npc.getConditions()).toContain("prone");

    npc.clearAllConditions();
    expect(npc.getConditions()).toEqual([]);
  });

  it("rolls initiative using the provided DiceRoller", () => {
    const npc = new NPC({
      id: "c2",
      name: "Fast",
      maxHP: 10,
      currentHP: 10,
      armorClass: 12,
      speed: 30,
      abilityScores: new AbilityScores({
        strength: 10,
        dexterity: 14,
        constitution: 10,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
      }),
      proficiencyBonus: 2,
    });

    // Dex 14 => +2 modifier
    const roller = new FixedDiceRoller(11);
    expect(npc.rollInitiative(roller)).toBe(13);
  });
});
