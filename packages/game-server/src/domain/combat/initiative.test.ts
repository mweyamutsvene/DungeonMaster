import { describe, expect, it } from "vitest";

import { AbilityScores } from "../entities/core/ability-scores.js";
import { Character } from "../entities/creatures/character.js";
import { FixedDiceRoller } from "../rules/dice-roller.js";
import { rollInitiative, swapInitiative } from "./initiative.js";

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

describe("rollInitiative (tie-breaking)", () => {
  it("breaks initiative ties by DEX score (higher DEX first)", () => {
    const dice = new FixedDiceRoller(10);
    const lowDex = makeCharacter({ id: "a", dex: 10 });
    const highDex = makeCharacter({ id: "b", dex: 16 });

    // Both roll 10 on d20; lowDex gets 10+0=10, highDex gets 10+3=13 → different initiatives.
    // To test tie-breaking, we need same initiative. Use dex values that give same modifier.
    const dex12 = makeCharacter({ id: "x", dex: 12 }); // mod +1 → initiative 11
    const dex13 = makeCharacter({ id: "y", dex: 13 }); // mod +1 → initiative 11

    const entries = rollInitiative(dice, [dex12, dex13]);
    // Same initiative (11), tie-break by DEX score: 13 > 12, so "y" goes first.
    expect(entries[0].creature.getId()).toBe("y");
    expect(entries[1].creature.getId()).toBe("x");
  });

  it("falls back to alphabetical ID when initiative and DEX are equal", () => {
    const dice = new FixedDiceRoller(10);
    const c1 = makeCharacter({ id: "bravo", dex: 14 });
    const c2 = makeCharacter({ id: "alpha", dex: 14 });

    const entries = rollInitiative(dice, [c1, c2]);
    // Same initiative (12), same DEX (14), fall back to alphabetical: "alpha" < "bravo".
    expect(entries[0].creature.getId()).toBe("alpha");
    expect(entries[1].creature.getId()).toBe("bravo");
  });
});

describe("swapInitiative", () => {
  it("swaps initiative values between two actors", () => {
    const order = [
      { actorId: "a", initiative: 20 },
      { actorId: "b", initiative: 15 },
      { actorId: "c", initiative: 10 },
    ];

    const result = swapInitiative(order, "a", "c");

    const byId = new Map(result.map(e => [e.actorId, e.initiative] as const));
    expect(byId.get("a")).toBe(10); // was 20
    expect(byId.get("c")).toBe(20); // was 10
    expect(byId.get("b")).toBe(15); // unchanged
  });

  it("returns result sorted by initiative (highest first)", () => {
    const order = [
      { actorId: "a", initiative: 20 },
      { actorId: "b", initiative: 15 },
      { actorId: "c", initiative: 10 },
    ];

    const result = swapInitiative(order, "a", "c");

    // After swap: c=20, b=15, a=10
    expect(result[0].actorId).toBe("c");
    expect(result[1].actorId).toBe("b");
    expect(result[2].actorId).toBe("a");
  });

  it("returns unchanged copy if actor not found", () => {
    const order = [
      { actorId: "a", initiative: 20 },
      { actorId: "b", initiative: 10 },
    ];

    const result = swapInitiative(order, "missing", "b");

    expect(result).toEqual([
      { actorId: "a", initiative: 20 },
      { actorId: "b", initiative: 10 },
    ]);
  });

  it("returns unchanged copy if target not found", () => {
    const order = [
      { actorId: "a", initiative: 20 },
      { actorId: "b", initiative: 10 },
    ];

    const result = swapInitiative(order, "a", "missing");

    expect(result).toEqual([
      { actorId: "a", initiative: 20 },
      { actorId: "b", initiative: 10 },
    ]);
  });
});
