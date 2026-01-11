import { describe, expect, it } from "vitest";

import { AbilityScores } from "../entities/core/ability-scores.js";
import { Character } from "../entities/creatures/character.js";
import { NPC } from "../entities/creatures/npc.js";
import { FixedDiceRoller, type DiceRoller, type DiceRoll } from "../rules/dice-roller.js";
import { resolveAttack } from "./attack-resolver.js";

class SequenceDiceRoller implements DiceRoller {
  private readonly values: number[];

  public constructor(values: number[]) {
    if (values.length === 0) {
      throw new Error("SequenceDiceRoller requires at least one value");
    }
    this.values = [...values];
  }

  public d20(modifier = 0): DiceRoll {
    const v = this.values.shift();
    if (v === undefined) {
      throw new Error("SequenceDiceRoller ran out of values");
    }
    return { total: v + modifier, rolls: [v] };
  }

  public rollDie(_sides: number, count = 1, modifier = 0): DiceRoll {
    const rolls = Array.from({ length: count }, () => 1);
    const total = rolls.reduce((sum, r) => sum + r, 0) + modifier;
    return { total, rolls };
  }
}

function makeNpc(id: string, ac: number): NPC {
  return new NPC({
    id,
    name: id,
    maxHP: 20,
    currentHP: 20,
    armorClass: ac,
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

function makeArcher(id: string): Character {
  return new Character({
    id,
    name: id,
    maxHP: 20,
    currentHP: 20,
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
    characterClass: "Fighter",
    classId: "fighter",
    experiencePoints: 0,
    featIds: ["feat_archery"],
  });
}

function makeGreatWeaponFighter(id: string): Character {
  return new Character({
    id,
    name: id,
    maxHP: 20,
    currentHP: 20,
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
    characterClass: "Fighter",
    classId: "fighter",
    experiencePoints: 0,
    featIds: ["feat_great-weapon-fighting"],
  });
}

describe("resolveAttack", () => {
  it("applies damage on hit", () => {
    // Fixed roller returns 15 for d20 and all damage dice.
    const dice = new FixedDiceRoller(15);
    const attacker = makeNpc("attacker", 10);
    const target = makeNpc("target", 12);

    const result = resolveAttack(dice, attacker, target, {
      attackBonus: 3,
      damage: { diceCount: 1, diceSides: 8, modifier: 2 },
    });

    expect(result.hit).toBe(true);
    expect(result.critical).toBe(false);
    expect(result.attack.total).toBe(18);

    // Damage: fixed 15 + 2
    expect(result.damage.applied).toBe(17);
    expect(target.getCurrentHP()).toBe(3);
  });

  it("does not apply damage on miss", () => {
    const dice = new FixedDiceRoller(5);
    const attacker = makeNpc("attacker", 10);
    const target = makeNpc("target", 20);

    const result = resolveAttack(dice, attacker, target, {
      attackBonus: 3,
      damage: { diceCount: 1, diceSides: 8, modifier: 2 },
    });

    expect(result.hit).toBe(false);
    expect(result.damage.applied).toBe(0);
    expect(target.getCurrentHP()).toBe(20);
  });

  it("applies Archery feat bonus to ranged attack rolls", () => {
    const dice = new FixedDiceRoller(10);
    const attacker = makeArcher("archer");
    const target = makeNpc("target", 12);

    const result = resolveAttack(dice, attacker, target, {
      kind: "ranged",
      attackBonus: 0,
      damage: { diceCount: 1, diceSides: 6, modifier: 0 },
    });

    // d20=10 + 2 from Archery
    expect(result.attack.total).toBe(12);
    expect(result.hit).toBe(true);
  });

  it("applies Great Weapon Fighting minimums to qualifying damage dice", () => {
    // Fixed roller returns 10 for d20 and 1 for all damage dice.
    const dice = new FixedDiceRoller(1);
    const attacker = makeGreatWeaponFighter("gwf");
    const target = makeNpc("target", 1);

    const result = resolveAttack(dice, attacker, target, {
      kind: "melee",
      attackBonus: 20,
      weapon: { properties: ["Two-Handed"], hands: 2 },
      damage: { diceCount: 2, diceSides: 6, modifier: 0 },
    });

    expect(result.hit).toBe(true);
    // 2d6 with fixed 1s becomes 3 + 3 = 6
    expect(result.damage.roll.rolls).toEqual([3, 3]);
    expect(result.damage.applied).toBe(6);
  });

  it("applies untrained-armor disadvantage to STR/DEX attack rolls", () => {
    // First d20 would hit (15), but disadvantage will roll twice (15, 5) and choose 5.
    const dice = new SequenceDiceRoller([15, 5]);

    const attacker = new Character({
      id: "u1",
      name: "Untrained",
      maxHP: 20,
      currentHP: 20,
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

    const target = makeNpc("target", 10);

    const result = resolveAttack(dice, attacker, target, {
      kind: "melee",
      attackAbility: "strength",
      attackBonus: 0,
      damage: { diceCount: 1, diceSides: 6, modifier: 0 },
    });

    expect(result.hit).toBe(false);
    expect(result.attack.d20).toBe(5);
    expect(target.getCurrentHP()).toBe(20);
  });

  it("infers Dexterity for finesse melee attacks when Dex mod >= Str mod", () => {
    class DexOnlyDisadvantageNpc extends NPC {
      public getD20TestModeForAbility(ability: "strength" | "dexterity", baseMode: "normal" | "advantage" | "disadvantage") {
        if (ability === "dexterity") {
          if (baseMode === "advantage") return "normal";
          return "disadvantage";
        }
        return baseMode;
      }
    }

    // If resolver picks Dex, we get disadvantage and choose the low roll.
    const dice = new SequenceDiceRoller([15, 5]);

    const attacker = new DexOnlyDisadvantageNpc({
      id: "fin1",
      name: "Finesse",
      maxHP: 20,
      currentHP: 20,
      armorClass: 10,
      speed: 30,
      abilityScores: new AbilityScores({
        strength: 10, // mod 0
        dexterity: 18, // mod +4
        constitution: 10,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
      }),
      proficiencyBonus: 2,
    });

    const target = makeNpc("target", 10);

    const result = resolveAttack(dice, attacker, target, {
      kind: "melee",
      // No attackAbility provided: should infer Dex due to Finesse + Dex mod >= Str mod.
      attackBonus: 0,
      weapon: { properties: ["Finesse"], hands: 1 },
      damage: { diceCount: 1, diceSides: 6, modifier: 0 },
    });

    expect(result.attack.d20).toBe(5);
    expect(result.hit).toBe(false);
  });
});
