/**
 * Fighting Style — Attack Resolver Integration Tests
 * 
 * Tests that Dueling and other fighting style effects are correctly
 * applied through the attack resolution pipeline.
 */
import { describe, it, expect } from "vitest";
import { resolveAttack, type AttackSpec } from "./attack-resolver.js";
import { Character } from "../entities/creatures/character.js";
import { AbilityScores } from "../entities/core/ability-scores.js";
import { FixedDiceRoller } from "../rules/dice-roller.js";

function makeAttacker(overrides: Record<string, unknown> = {}): Character {
  return new Character({
    id: "attacker",
    name: "Fighter",
    maxHP: 30,
    currentHP: 30,
    armorClass: 16,
    speed: 30,
    abilityScores: new AbilityScores({
      strength: 16,      // +3 mod
      dexterity: 14,     // +2 mod
      constitution: 14,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
    }),
    level: 5,
    characterClass: "Fighter",
    classId: "fighter",
    experiencePoints: 0,
    ...overrides,
  });
}

function makeTarget(): Character {
  return new Character({
    id: "target",
    name: "Target",
    maxHP: 50,
    currentHP: 50,
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
  });
}

describe("Dueling fighting style in attack resolution", () => {
  it("adds +2 damage to one-handed melee attacks", () => {
    const attacker = makeAttacker({ fightingStyle: "dueling" });
    const target = makeTarget();
    // d20 roll = 15 (hit), damage roll = 5
    const roller = new FixedDiceRoller([15, 5]);

    const spec: AttackSpec = {
      kind: "melee",
      attackBonus: 6,
      damage: { diceCount: 1, diceSides: 8, modifier: 3 },
      weapon: { hands: 1 },
    };

    const result = resolveAttack(roller, attacker, target, spec);
    expect(result.hit).toBe(true);
    // Damage: 5 + 3 (modifier) + 2 (dueling) = 10
    expect(result.damage.roll.total).toBe(10);
  });

  it("does not add bonus to two-handed melee attacks", () => {
    const attacker = makeAttacker({ fightingStyle: "dueling" });
    const target = makeTarget();
    const roller = new FixedDiceRoller([15, 5]);

    const spec: AttackSpec = {
      kind: "melee",
      attackBonus: 6,
      damage: { diceCount: 1, diceSides: 10, modifier: 3 },
      weapon: { hands: 2, properties: ["Two-Handed"] },
    };

    const result = resolveAttack(roller, attacker, target, spec);
    expect(result.hit).toBe(true);
    // Damage: 5 + 3 = 8 (no dueling bonus)
    expect(result.damage.roll.total).toBe(8);
  });

  it("does not add bonus to ranged attacks", () => {
    const attacker = makeAttacker({ fightingStyle: "dueling" });
    const target = makeTarget();
    const roller = new FixedDiceRoller([15, 5]);

    const spec: AttackSpec = {
      kind: "ranged",
      attackBonus: 5,
      damage: { diceCount: 1, diceSides: 8, modifier: 2 },
      weapon: { hands: 1 },
    };

    const result = resolveAttack(roller, attacker, target, spec);
    expect(result.hit).toBe(true);
    // Damage: 5 + 2 = 7 (no dueling bonus for ranged)
    expect(result.damage.roll.total).toBe(7);
  });
});

describe("Archery fighting style in attack resolution", () => {
  it("adds +2 to ranged attack roll total", () => {
    const attacker = makeAttacker({ fightingStyle: "archery" });
    const target = makeTarget();
    // d20 roll = 10, damage roll = 5
    const roller = new FixedDiceRoller([10, 5]);

    const spec: AttackSpec = {
      kind: "ranged",
      attackBonus: 5,
      damage: { diceCount: 1, diceSides: 8, modifier: 2 },
    };

    const result = resolveAttack(roller, attacker, target, spec);
    // Attack: 10 + 5 (base) + 2 (archery) = 17
    expect(result.attack.total).toBe(17);
    expect(result.hit).toBe(true);
  });

  it("does not add bonus to melee attack rolls", () => {
    const attacker = makeAttacker({ fightingStyle: "archery" });
    const target = makeTarget();
    const roller = new FixedDiceRoller([10, 5]);

    const spec: AttackSpec = {
      kind: "melee",
      attackBonus: 5,
      damage: { diceCount: 1, diceSides: 8, modifier: 3 },
    };

    const result = resolveAttack(roller, attacker, target, spec);
    // Attack: 10 + 5 = 15 (no archery bonus for melee)
    expect(result.attack.total).toBe(15);
  });
});

describe("GWF fighting style in attack resolution", () => {
  it("rerolls 1s and 2s on damage dice (treats as minimum 3)", () => {
    const attacker = makeAttacker({ fightingStyle: "great-weapon-fighting" });
    const target = makeTarget();
    // d20 = 15 (hit), damage roll = 1 (will be treated as 3)
    const roller = new FixedDiceRoller([15, 1]);

    const spec: AttackSpec = {
      kind: "melee",
      attackBonus: 6,
      damage: { diceCount: 1, diceSides: 12, modifier: 3 },
      weapon: { hands: 2, properties: ["Two-Handed"] },
    };

    const result = resolveAttack(roller, attacker, target, spec);
    expect(result.hit).toBe(true);
    // Damage: min(1→3) + 3 = 6
    expect(result.damage.roll.total).toBe(6);
  });
});

describe("Fighting style through feat and class unification", () => {
  it("same effect whether from feat or fighting style", () => {
    const viaStyle = makeAttacker({ fightingStyle: "archery" });
    const viaFeat = makeAttacker({ featIds: ["feat_archery"] });

    const target1 = makeTarget();
    const target2 = makeTarget();
    const roller1 = new FixedDiceRoller([10, 5]);
    const roller2 = new FixedDiceRoller([10, 5]);

    const spec: AttackSpec = {
      kind: "ranged",
      attackBonus: 5,
      damage: { diceCount: 1, diceSides: 8, modifier: 2 },
    };

    const result1 = resolveAttack(roller1, viaStyle, target1, spec);
    const result2 = resolveAttack(roller2, viaFeat, target2, spec);

    expect(result1.attack.total).toBe(result2.attack.total);
    expect(result1.damage.roll.total).toBe(result2.damage.roll.total);
  });

  it("does not double-stack when both feat and fighting style are present", () => {
    const attacker = makeAttacker({
      fightingStyle: "archery",
      featIds: ["feat_archery"],
    });
    const target = makeTarget();
    const roller = new FixedDiceRoller([10, 5]);

    const spec: AttackSpec = {
      kind: "ranged",
      attackBonus: 5,
      damage: { diceCount: 1, diceSides: 8, modifier: 2 },
    };

    const result = resolveAttack(roller, attacker, target, spec);
    // Should still only be +2, not +4
    expect(result.attack.total).toBe(17); // 10 + 5 + 2
  });
});
