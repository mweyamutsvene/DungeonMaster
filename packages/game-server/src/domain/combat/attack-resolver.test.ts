import { describe, expect, it } from "vitest";

import { AbilityScores } from "../entities/core/ability-scores.js";
import { Character } from "../entities/creatures/character.js";
import { NPC } from "../entities/creatures/npc.js";
import { FixedDiceRoller, type DiceRoller, type DiceRoll } from "../rules/dice-roller.js";
import { resolveAttack, isAutoCriticalHit } from "./attack-resolver.js";

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

function makeLuckyFighter(id: string): Character {
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
    featIds: ["feat_lucky"],
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

  it("does not auto-spend Lucky on miss (application layer decides)", () => {
    const dice = new SequenceDiceRoller([5]);
    const attacker = makeLuckyFighter("lucky");
    const target = makeNpc("target", 20);

    const result = resolveAttack(dice, attacker, target, {
      attackBonus: 3,
      damage: { diceCount: 1, diceSides: 8, modifier: 2 },
    });

    expect(result.hit).toBe(false);
    expect(result.attack.d20).toBe(5);
    expect(result.luckyUsed).toBe(false);
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

  it("applies terrain elevation advantage when requested", () => {
    const dice = new SequenceDiceRoller([4, 16]);
    const attacker = makeNpc("attacker", 10);
    const target = makeNpc("target", 12);

    const result = resolveAttack(
      dice,
      attacker,
      target,
      {
        kind: "melee",
        attackBonus: 0,
        damage: { diceCount: 1, diceSides: 6, modifier: 0 },
      },
      { elevationAdvantage: true },
    );

    expect(result.attack.d20).toBe(16);
    expect(result.hit).toBe(true);
  });

  it("applies Great Weapon Fighting minimums to qualifying damage dice", () => {
    // SequenceDiceRoller returns 10 for d20 and 1 for all damage dice.
    const dice = new SequenceDiceRoller([10]);
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

  it("natural 1 always misses even with high bonus vs low AC", () => {
    const dice = new FixedDiceRoller(1);
    const attacker = makeNpc("attacker", 10);
    const target = makeNpc("target", 1); // AC 1

    const result = resolveAttack(dice, attacker, target, {
      attackBonus: 20, // d20(1) + 20 = 21, but natural 1 always misses
      damage: { diceCount: 1, diceSides: 8, modifier: 2 },
    });

    expect(result.hit).toBe(false);
    expect(result.attack.d20).toBe(1);
    expect(result.damage.applied).toBe(0);
    expect(target.getCurrentHP()).toBe(20);
  });

  it("auto-crits melee hit on paralyzed target within 5ft", () => {
    const dice = new FixedDiceRoller(15);
    const attacker = makeNpc("attacker", 10);
    const target = makeNpc("target", 12);
    target.addCondition("paralyzed");

    const result = resolveAttack(dice, attacker, target, {
      kind: "melee",
      attackBonus: 3,
      damage: { diceCount: 1, diceSides: 8, modifier: 0 },
    }, { attackerDistance: 5 });

    expect(result.hit).toBe(true);
    expect(result.critical).toBe(true);
    // Critical doubles dice: 2d8 with fixed roller returning 15 each = 30
    expect(result.damage.roll.rolls.length).toBe(2);
  });

  it("auto-crits melee hit on unconscious target within 5ft", () => {
    const dice = new FixedDiceRoller(15);
    const attacker = makeNpc("attacker", 10);
    const target = makeNpc("target", 12);
    target.addCondition("unconscious");

    const result = resolveAttack(dice, attacker, target, {
      kind: "melee",
      attackBonus: 3,
      damage: { diceCount: 1, diceSides: 8, modifier: 0 },
    }, { attackerDistance: 5 });

    expect(result.hit).toBe(true);
    expect(result.critical).toBe(true);
  });

  it("does NOT auto-crit melee hit on paralyzed target beyond 5ft", () => {
    const dice = new FixedDiceRoller(15);
    const attacker = makeNpc("attacker", 10);
    const target = makeNpc("target", 12);
    target.addCondition("paralyzed");

    const result = resolveAttack(dice, attacker, target, {
      kind: "melee",
      attackBonus: 3,
      damage: { diceCount: 1, diceSides: 8, modifier: 0 },
    }, { attackerDistance: 10 });

    expect(result.hit).toBe(true);
    expect(result.critical).toBe(false);
  });

  it("does NOT auto-crit ranged hit on paralyzed target within 5ft", () => {
    const dice = new FixedDiceRoller(15);
    const attacker = makeNpc("attacker", 10);
    const target = makeNpc("target", 12);
    target.addCondition("paralyzed");

    const result = resolveAttack(dice, attacker, target, {
      kind: "ranged",
      attackBonus: 3,
      damage: { diceCount: 1, diceSides: 8, modifier: 0 },
    }, { attackerDistance: 5 });

    expect(result.hit).toBe(true);
    expect(result.critical).toBe(false);
  });

  it("Champion Fighter crits on natural 19 (Improved Critical)", () => {
    const dice = new FixedDiceRoller(19);
    const attacker = new Character({
      id: "champ1",
      name: "Champion",
      maxHP: 30,
      currentHP: 30,
      armorClass: 18,
      speed: 30,
      abilityScores: new AbilityScores({
        strength: 16,
        dexterity: 10,
        constitution: 14,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
      }),
      level: 3,
      characterClass: "Fighter",
      classId: "fighter",
      subclass: "Champion",
      experiencePoints: 0,
    });
    const target = makeNpc("target", 25); // High AC, only crits hit

    const result = resolveAttack(dice, attacker, target, {
      kind: "melee",
      attackBonus: 5,
      damage: { diceCount: 1, diceSides: 10, modifier: 3 },
    });

    expect(result.hit).toBe(true);
    expect(result.critical).toBe(true);
    // Critical doubles dice
    expect(result.damage.roll.rolls.length).toBe(2);
  });

  it("non-Champion Fighter does NOT crit on natural 19", () => {
    const dice = new FixedDiceRoller(19);
    const attacker = new Character({
      id: "f1",
      name: "Fighter",
      maxHP: 30,
      currentHP: 30,
      armorClass: 18,
      speed: 30,
      abilityScores: new AbilityScores({
        strength: 16,
        dexterity: 10,
        constitution: 14,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
      }),
      level: 3,
      characterClass: "Fighter",
      classId: "fighter",
      experiencePoints: 0,
    });
    const target = makeNpc("target", 25);

    const result = resolveAttack(dice, attacker, target, {
      kind: "melee",
      attackBonus: 5,
      damage: { diceCount: 1, diceSides: 10, modifier: 3 },
    });

    // 19 + 5 = 24 < 25, so it's a miss (and not a crit)
    expect(result.hit).toBe(false);
    expect(result.critical).toBe(false);
  });

  it("Champion level 2 does NOT crit on natural 19 (below Improved Critical level)", () => {
    const dice = new FixedDiceRoller(19);
    const attacker = new Character({
      id: "champ2",
      name: "Young Champion",
      maxHP: 20,
      currentHP: 20,
      armorClass: 16,
      speed: 30,
      abilityScores: new AbilityScores({
        strength: 16,
        dexterity: 10,
        constitution: 14,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
      }),
      level: 2,
      characterClass: "Fighter",
      classId: "fighter",
      subclass: "Champion",
      experiencePoints: 0,
    });
    const target = makeNpc("target", 25);

    const result = resolveAttack(dice, attacker, target, {
      kind: "melee",
      attackBonus: 5,
      damage: { diceCount: 1, diceSides: 10, modifier: 3 },
    });

    expect(result.hit).toBe(false);
    expect(result.critical).toBe(false);
  });

  it("Savage Attacker uses higher of two damage rolls", () => {
    // Custom roller: d20 returns 15 (hit), first rollDie returns low (3), second returns high (8).
    let rollDieCallCount = 0;
    const dice: DiceRoller = {
      d20(modifier = 0) {
        return { total: 15 + modifier, rolls: [15] };
      },
      rollDie(_sides: number, count = 1, modifier = 0) {
        rollDieCallCount++;
        if (rollDieCallCount === 1) {
          // First damage roll: low
          const rolls = Array.from({ length: count }, () => 3);
          return { total: rolls.reduce((s, r) => s + r, 0) + modifier, rolls };
        }
        // Second damage roll: high
        const rolls = Array.from({ length: count }, () => 8);
        return { total: rolls.reduce((s, r) => s + r, 0) + modifier, rolls };
      },
    };

    const attacker = new Character({
      id: "sa1",
      name: "Savage",
      maxHP: 20,
      currentHP: 20,
      armorClass: 10,
      speed: 30,
      abilityScores: new AbilityScores({
        strength: 16,
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
      featIds: ["feat_savage-attacker"],
    });
    const target = makeNpc("target", 10);

    const result = resolveAttack(dice, attacker, target, {
      kind: "melee",
      attackBonus: 5,
      damage: { diceCount: 1, diceSides: 8, modifier: 2 },
    });

    expect(result.hit).toBe(true);
    // Should use the higher second roll: 8 + 2 = 10 (not first roll: 3 + 2 = 5)
    expect(result.damage.applied).toBe(10);
    expect(result.damage.roll.rolls).toEqual([8]);
    expect(rollDieCallCount).toBe(2);
  });

  it("Savage Attacker keeps first roll when it is higher", () => {
    let rollDieCallCount = 0;
    const dice: DiceRoller = {
      d20(modifier = 0) {
        return { total: 15 + modifier, rolls: [15] };
      },
      rollDie(_sides: number, count = 1, modifier = 0) {
        rollDieCallCount++;
        if (rollDieCallCount === 1) {
          // First damage roll: high
          const rolls = Array.from({ length: count }, () => 7);
          return { total: rolls.reduce((s, r) => s + r, 0) + modifier, rolls };
        }
        // Second damage roll: low
        const rolls = Array.from({ length: count }, () => 2);
        return { total: rolls.reduce((s, r) => s + r, 0) + modifier, rolls };
      },
    };

    const attacker = new Character({
      id: "sa2",
      name: "Savage2",
      maxHP: 20,
      currentHP: 20,
      armorClass: 10,
      speed: 30,
      abilityScores: new AbilityScores({
        strength: 16,
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
      featIds: ["feat_savage-attacker"],
    });
    const target = makeNpc("target", 10);

    const result = resolveAttack(dice, attacker, target, {
      kind: "melee",
      attackBonus: 5,
      damage: { diceCount: 1, diceSides: 8, modifier: 2 },
    });

    expect(result.hit).toBe(true);
    // Should keep the first roll: 7 + 2 = 9 (not second: 2 + 2 = 4)
    expect(result.damage.applied).toBe(9);
    expect(result.damage.roll.rolls).toEqual([7]);
  });

  it("Savage Attacker does not trigger on miss", () => {
    let rollDieCallCount = 0;
    const dice: DiceRoller = {
      d20(modifier = 0) {
        return { total: 2 + modifier, rolls: [2] };
      },
      rollDie(_sides: number, count = 1, modifier = 0) {
        rollDieCallCount++;
        const rolls = Array.from({ length: count }, () => 1);
        return { total: rolls.reduce((s, r) => s + r, 0) + modifier, rolls };
      },
    };

    const attacker = new Character({
      id: "sa3",
      name: "Savage3",
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
      featIds: ["feat_savage-attacker"],
    });
    const target = makeNpc("target", 18);

    const result = resolveAttack(dice, attacker, target, {
      kind: "melee",
      attackBonus: 0,
      damage: { diceCount: 1, diceSides: 8, modifier: 0 },
    });

    expect(result.hit).toBe(false);
    // Only one rollDie call (the initial damage roll), no second Savage Attacker roll
    expect(rollDieCallCount).toBe(1);
    expect(result.savageAttackerUsed).toBe(false);
  });

  it("Savage Attacker returns savageAttackerUsed=true on first use", () => {
    const dice: DiceRoller = {
      d20(modifier = 0) {
        return { total: 15 + modifier, rolls: [15] };
      },
      rollDie(_sides: number, count = 1, modifier = 0) {
        const rolls = Array.from({ length: count }, () => 5);
        return { total: rolls.reduce((s, r) => s + r, 0) + modifier, rolls };
      },
    };

    const attacker = new Character({
      id: "sa-track",
      name: "SavageTracker",
      maxHP: 20,
      currentHP: 20,
      armorClass: 10,
      speed: 30,
      abilityScores: new AbilityScores({
        strength: 16,
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
      featIds: ["feat_savage-attacker"],
    });
    const target = makeNpc("target", 10);

    const result = resolveAttack(dice, attacker, target, {
      kind: "melee",
      attackBonus: 5,
      damage: { diceCount: 1, diceSides: 8, modifier: 2 },
    });

    expect(result.hit).toBe(true);
    expect(result.savageAttackerUsed).toBe(true);
  });

  it("Savage Attacker does not trigger when savageAttackerUsedThisTurn is set", () => {
    let rollDieCallCount = 0;
    const dice: DiceRoller = {
      d20(modifier = 0) {
        return { total: 15 + modifier, rolls: [15] };
      },
      rollDie(_sides: number, count = 1, modifier = 0) {
        rollDieCallCount++;
        const rolls = Array.from({ length: count }, () => 4);
        return { total: rolls.reduce((s, r) => s + r, 0) + modifier, rolls };
      },
    };

    const attacker = new Character({
      id: "sa-used",
      name: "SavageUsed",
      maxHP: 20,
      currentHP: 20,
      armorClass: 10,
      speed: 30,
      abilityScores: new AbilityScores({
        strength: 16,
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
      featIds: ["feat_savage-attacker"],
    });
    const target = makeNpc("target", 10);

    const result = resolveAttack(dice, attacker, target, {
      kind: "melee",
      attackBonus: 5,
      damage: { diceCount: 1, diceSides: 8, modifier: 2 },
    }, { savageAttackerUsedThisTurn: true });

    expect(result.hit).toBe(true);
    // Only one rollDie call — Savage Attacker did NOT trigger second roll
    expect(rollDieCallCount).toBe(1);
    expect(result.savageAttackerUsed).toBe(false);
  });
});

describe("isAutoCriticalHit", () => {
  it("returns true for paralyzed target with melee within 5ft", () => {
    const target = makeNpc("target", 10);
    target.addCondition("paralyzed");
    expect(isAutoCriticalHit(target, "melee", 5)).toBe(true);
  });

  it("returns true for unconscious target with melee within 5ft", () => {
    const target = makeNpc("target", 10);
    target.addCondition("unconscious");
    expect(isAutoCriticalHit(target, "melee", 5)).toBe(true);
  });

  it("returns false for paralyzed target beyond 5ft", () => {
    const target = makeNpc("target", 10);
    target.addCondition("paralyzed");
    expect(isAutoCriticalHit(target, "melee", 10)).toBe(false);
  });

  it("returns false for ranged attack on paralyzed target", () => {
    const target = makeNpc("target", 10);
    target.addCondition("paralyzed");
    expect(isAutoCriticalHit(target, "ranged", 5)).toBe(false);
  });

  it("returns false for target without qualifying condition", () => {
    const target = makeNpc("target", 10);
    target.addCondition("stunned");
    expect(isAutoCriticalHit(target, "melee", 5)).toBe(false);
  });

  it("matches title-case condition literals against a case-sensitive adapter", () => {
    // Regression guard: attack-resolver now calls hasCondition("Paralyzed") /
    // hasCondition("Unconscious") (title-case). Case-sensitive adapters must
    // still auto-crit when the condition is stored title-case.
    const titleCaseTarget = {
      hasCondition: (c: string) => c === "Paralyzed",
    } as unknown as Parameters<typeof isAutoCriticalHit>[0];
    expect(isAutoCriticalHit(titleCaseTarget, "melee", 5)).toBe(true);

    const unconsciousTarget = {
      hasCondition: (c: string) => c === "Unconscious",
    } as unknown as Parameters<typeof isAutoCriticalHit>[0];
    expect(isAutoCriticalHit(unconsciousTarget, "melee", 5)).toBe(true);

    // Lowercase stored conditions should NOT trigger auto-crit on a
    // case-sensitive adapter — this proves the fix is actually title-case.
    const lowercaseOnly = {
      hasCondition: (c: string) => c === "paralyzed",
    } as unknown as Parameters<typeof isAutoCriticalHit>[0];
    expect(isAutoCriticalHit(lowercaseOnly, "melee", 5)).toBe(false);
  });
});

describe("Grappler feat advantage", () => {
  function makeGrappler(id: string): Character {
    return new Character({
      id,
      name: id,
      maxHP: 20,
      currentHP: 20,
      armorClass: 10,
      speed: 30,
      abilityScores: new AbilityScores({
        strength: 16,
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
      featIds: ["feat_grappler"],
    });
  }

  it("grants advantage when attacker has Grappler feat and is grappling target", () => {
    // Advantage picks higher: 15 vs 5 → 15
    const dice = new SequenceDiceRoller([15, 5]);
    const attacker = makeGrappler("grappler");
    const target = makeNpc("target", 14);

    const result = resolveAttack(dice, attacker, target, {
      kind: "melee",
      attackBonus: 0,
      damage: { diceCount: 1, diceSides: 6, modifier: 0 },
    }, { attackerIsGrapplingTarget: true });

    expect(result.hit).toBe(true);
    expect(result.attack.d20).toBe(15);
  });

  it("does not grant advantage without Grappler feat even when grappling", () => {
    const dice = new SequenceDiceRoller([5]);
    const attacker = makeNpc("attacker", 10);
    const target = makeNpc("target", 14);

    const result = resolveAttack(dice, attacker, target, {
      kind: "melee",
      attackBonus: 0,
      damage: { diceCount: 1, diceSides: 6, modifier: 0 },
    }, { attackerIsGrapplingTarget: true });

    // No advantage, single roll of 5
    expect(result.hit).toBe(false);
    expect(result.attack.d20).toBe(5);
  });

  it("does not grant advantage with Grappler feat when not grappling target", () => {
    const dice = new SequenceDiceRoller([5]);
    const attacker = makeGrappler("grappler");
    const target = makeNpc("target", 14);

    const result = resolveAttack(dice, attacker, target, {
      kind: "melee",
      attackBonus: 0,
      damage: { diceCount: 1, diceSides: 6, modifier: 0 },
    });

    // No advantage, single roll of 5
    expect(result.hit).toBe(false);
    expect(result.attack.d20).toBe(5);
  });

  it("neutralizes disadvantage to normal when grappler feat + grappling + disadvantage", () => {
    const dice = new SequenceDiceRoller([15]);
    const attacker = makeGrappler("grappler");
    const target = makeNpc("target", 14);

    const result = resolveAttack(dice, attacker, target, {
      kind: "melee",
      mode: "disadvantage",
      attackBonus: 0,
      damage: { diceCount: 1, diceSides: 6, modifier: 0 },
    }, { attackerIsGrapplingTarget: true });

    // Disadvantage + advantage cancel to normal → single roll of 15
    expect(result.hit).toBe(true);
    expect(result.attack.d20).toBe(15);
  });
});

describe("additionalDamage", () => {
  it("applies additional damage types with separate defense checks", () => {
    // Roller: d20=15 (hit), primary 1d8=1, additional 2d6=1+1=2
    const dice = new SequenceDiceRoller([15]);
    const attacker = makeArcher("flame");
    const target = makeNpc("target", 10);

    const result = resolveAttack(dice, attacker, target, {
      kind: "melee",
      attackBonus: 5,
      damage: { diceCount: 1, diceSides: 8, modifier: 3 },
      damageType: "slashing",
      additionalDamage: [
        { dice: "2d6", damageType: "fire" },
      ],
    });

    expect(result.hit).toBe(true);
    // Primary: 1 + 3 = 4 (SequenceDiceRoller.rollDie returns 1 per die)
    // Additional: 2 × 1 = 2
    // Total: 4 + 2 = 6
    expect(result.damage.applied).toBe(6);
    expect(result.damage.additionalDamageResults).toHaveLength(1);
    expect(result.damage.additionalDamageResults![0].damageType).toBe("fire");
    expect(result.damage.additionalDamageResults![0].rawDamage).toBe(2);
    expect(result.damage.additionalDamageResults![0].applied).toBe(2);
  });

  it("applies resistance only to the correct damage type", () => {
    const dice = new SequenceDiceRoller([15]);
    const attacker = makeArcher("flame");
    const target = makeNpc("target", 10);

    const result = resolveAttack(dice, attacker, target, {
      kind: "melee",
      attackBonus: 5,
      damage: { diceCount: 1, diceSides: 8, modifier: 3 },
      damageType: "slashing",
      additionalDamage: [
        { dice: "2d6", damageType: "fire" },
      ],
    }, {
      targetDefenses: {
        damageResistances: ["fire"],
      },
    });

    expect(result.hit).toBe(true);
    // Primary slashing: 1 + 3 = 4 (no resistance)
    // Additional fire: floor(2 / 2) = 1 (resistance)
    // Total: 4 + 1 = 5
    expect(result.damage.applied).toBe(5);
    expect(result.damage.defenseApplied).toBe("none"); // No slashing defense
    expect(result.damage.additionalDamageResults![0].defenseApplied).toBe("resistance");
    expect(result.damage.additionalDamageResults![0].applied).toBe(1);
  });

  it("doubles additional damage dice on critical hit", () => {
    // Natural 20 = crit
    const dice = new SequenceDiceRoller([20]);
    const attacker = makeArcher("crit");
    const target = makeNpc("target", 10);

    const result = resolveAttack(dice, attacker, target, {
      kind: "melee",
      attackBonus: 5,
      damage: { diceCount: 1, diceSides: 8, modifier: 3 },
      damageType: "slashing",
      additionalDamage: [
        { dice: "1d6", damageType: "fire" },
      ],
    });

    expect(result.critical).toBe(true);
    // Primary: 2d8 (crit doubles) = 2 × 1 + 3 = 5
    // Additional: 2d6 (crit doubles 1d6→2d6) = 2 × 1 = 2
    // Total: 5 + 2 = 7
    expect(result.damage.applied).toBe(7);
    expect(result.damage.additionalDamageResults![0].roll.rolls).toHaveLength(2); // doubled
  });

  it("does not apply additional damage on miss", () => {
    // Natural 1 = miss
    const dice = new SequenceDiceRoller([1]);
    const attacker = makeArcher("miss");
    const target = makeNpc("target", 10);

    const result = resolveAttack(dice, attacker, target, {
      kind: "melee",
      attackBonus: 5,
      damage: { diceCount: 1, diceSides: 8, modifier: 3 },
      damageType: "slashing",
      additionalDamage: [
        { dice: "2d6", damageType: "fire" },
      ],
    });

    expect(result.hit).toBe(false);
    expect(result.damage.applied).toBe(0);
    expect(result.damage.additionalDamageResults).toBeUndefined();
  });
});
