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

  describe("temporary HP", () => {
    function makeNpc(tempHP?: number) {
      return new NPC({
        id: "t1",
        name: "Test",
        maxHP: 20,
        currentHP: 20,
        tempHP,
        armorClass: 12,
        speed: 30,
        abilityScores: new AbilityScores({
          strength: 10,
          dexterity: 10,
          constitution: 10,
          intelligence: 10,
          wisdom: 10,
          charisma: 10,
        }),
        proficiencyBonus: 2,
      });
    }

    it("defaults to 0 if not provided", () => {
      const npc = makeNpc();
      expect(npc.getTempHP()).toBe(0);
    });

    it("absorbs damage through temp HP first", () => {
      const npc = makeNpc(10);
      npc.takeDamage(7);
      expect(npc.getTempHP()).toBe(3);
      expect(npc.getCurrentHP()).toBe(20); // real HP untouched
    });

    it("carries remaining damage to real HP after temp HP is depleted", () => {
      const npc = makeNpc(5);
      npc.takeDamage(12);
      expect(npc.getTempHP()).toBe(0);
      expect(npc.getCurrentHP()).toBe(13); // 20 - (12 - 5) = 13
    });

    it("handles damage exactly equal to temp HP", () => {
      const npc = makeNpc(8);
      npc.takeDamage(8);
      expect(npc.getTempHP()).toBe(0);
      expect(npc.getCurrentHP()).toBe(20);
    });

    it("setTempHP replaces when new value is higher", () => {
      const npc = makeNpc(5);
      npc.setTempHP(10);
      expect(npc.getTempHP()).toBe(10);
    });

    it("setTempHP does NOT replace when new value is lower", () => {
      const npc = makeNpc(10);
      npc.setTempHP(5);
      expect(npc.getTempHP()).toBe(10);
    });

    it("setTempHP does NOT replace when new value is equal", () => {
      const npc = makeNpc(10);
      npc.setTempHP(10);
      expect(npc.getTempHP()).toBe(10);
    });

    it("setTempHP rejects negative values", () => {
      const npc = makeNpc();
      expect(() => npc.setTempHP(-1)).toThrow("Temporary HP cannot be negative");
    });

    it("temp HP is included in toJSON", () => {
      const npc = makeNpc(7);
      expect(npc.toJSON().tempHP).toBe(7);
    });
  });
});
