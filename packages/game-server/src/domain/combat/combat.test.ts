import { describe, expect, it } from "vitest";

import { AbilityScores } from "../entities/core/ability-scores.js";
import { FixedDiceRoller } from "../rules/dice-roller.js";
import { NPC } from "../entities/creatures/npc.js";
import { Combat } from "./combat.js";

function makeNpc(id: string, dex: number): NPC {
  return new NPC({
    id,
    name: id,
    maxHP: 10,
    currentHP: 10,
    armorClass: 12,
    speed: 30,
    abilityScores: new AbilityScores({
      strength: 10,
      dexterity: dex,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
    }),
    proficiencyBonus: 2,
  });
}

describe("Combat", () => {
  it("creates a deterministic initiative order and advances turns/rounds", () => {
    // Fixed dice returns 10 on every d20.
    // Dex 14 => +2, Dex 10 => +0, so a should go first.
    const dice = new FixedDiceRoller(10);
    const a = makeNpc("a", 14);
    const b = makeNpc("b", 10);

    const combat = new Combat(dice, [a, b]);

    expect(combat.getRound()).toBe(1);
    expect(combat.getActiveCreature().getId()).toBe("a");

    combat.endTurn();
    expect(combat.getActiveCreature().getId()).toBe("b");

    combat.endTurn();
    expect(combat.getRound()).toBe(2);
    expect(combat.getActiveCreature().getId()).toBe("a");
  });

  it("tracks and resets action economy per turn", () => {
    const dice = new FixedDiceRoller(10);
    const a = makeNpc("a", 14);
    const b = makeNpc("b", 10);

    const combat = new Combat(dice, [a, b]);

    // a's turn
    expect(combat.canSpendAction("a")).toBe(true);
    combat.spendAction("a");
    expect(combat.canSpendAction("a")).toBe(false);
    expect(() => combat.spendAction("a")).toThrow();

    combat.spendMovement("a", 10);
    expect(combat.getActionEconomy("a").movementRemainingFeet).toBe(20);

    combat.endTurn();

    // b's turn
    expect(combat.getActiveCreature().getId()).toBe("b");
    expect(combat.canSpendAction("b")).toBe(true);

    combat.endTurn();

    // back to a (new round) => reset
    expect(combat.getActiveCreature().getId()).toBe("a");
    expect(combat.canSpendAction("a")).toBe(true);
    expect(combat.getActionEconomy("a").movementRemainingFeet).toBe(30);
  });
});
