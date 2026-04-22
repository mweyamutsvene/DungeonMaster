import { describe, expect, it } from "vitest";

import { AbilityScores } from "../entities/core/ability-scores.js";
import { NPC } from "../entities/creatures/npc.js";
import { createEffect } from "../entities/combat/effects.js";
import type { DiceRoll, DiceRoller } from "./dice-roller.js";
import { resolveSaveToEnd } from "./save-to-end.js";

class SequenceDiceRoller implements DiceRoller {
  private readonly values: number[];
  public constructor(values: number[]) {
    this.values = [...values];
  }
  public d20(modifier = 0): DiceRoll {
    const v = this.values.shift();
    if (v === undefined) throw new Error("SequenceDiceRoller ran out of values");
    return { total: v + modifier, rolls: [v] };
  }
  public rollDie(_sides: number, count = 1, modifier = 0): DiceRoll {
    const rolls = Array.from({ length: count }, () => 1);
    return { total: rolls.reduce((s, r) => s + r, 0) + modifier, rolls };
  }
}

function makeTarget(wisScore = 10): NPC {
  return new NPC({
    id: "t",
    name: "Target",
    maxHP: 30,
    currentHP: 30,
    armorClass: 12,
    speed: 30,
    abilityScores: new AbilityScores({
      strength: 10,
      dexterity: 10,
      constitution: 10,
      intelligence: 10,
      wisdom: wisScore,
      charisma: 10,
    }),
    proficiencyBonus: 2,
  });
}

function holdPersonEffect(dc = 15) {
  return createEffect("hp-1", "custom", "custom", "concentration", {
    source: "Hold Person",
    saveToEnd: { ability: "wisdom", dc, removeConditions: ["Paralyzed"] },
  });
}

describe("resolveSaveToEnd", () => {
  it("succeeds when roll + modifier >= DC and uses injected dice", () => {
    // WIS 14 → +2 mod. DC 15. Roll 13 + 2 = 15 → success.
    const target = makeTarget(14);
    const dice = new SequenceDiceRoller([13]);
    const res = resolveSaveToEnd(dice, target, holdPersonEffect(15));
    expect(res.success).toBe(true);
    expect(res.roll).toBe(13);
    expect(res.modifier).toBe(2);
    expect(res.totalRoll).toBe(15);
    expect(res.dc).toBe(15);
  });

  it("fails when roll + modifier < DC", () => {
    // WIS 10 → +0 mod. DC 15. Roll 10 + 0 = 10 → fail.
    const target = makeTarget(10);
    const dice = new SequenceDiceRoller([10]);
    const res = resolveSaveToEnd(dice, target, holdPersonEffect(15));
    expect(res.success).toBe(false);
    expect(res.totalRoll).toBe(10);
  });

  it("treats natural 20 as auto-success even when total < DC", () => {
    // WIS 1 → -5 mod. DC 30. Nat 20 + -5 = 15 < 30 but auto-success by 2024 rules.
    const target = makeTarget(1);
    const dice = new SequenceDiceRoller([20]);
    const res = resolveSaveToEnd(dice, target, holdPersonEffect(30));
    expect(res.success).toBe(true);
    expect(res.natural20).toBe(true);
  });

  it("treats natural 1 as auto-fail even when total >= DC", () => {
    // WIS 20 → +5 mod. DC 5. Nat 1 + 5 = 6 >= 5 but auto-fail.
    const target = makeTarget(20);
    const dice = new SequenceDiceRoller([1]);
    const res = resolveSaveToEnd(dice, target, holdPersonEffect(5));
    expect(res.success).toBe(false);
    expect(res.natural1).toBe(true);
  });

  it("adds proficiency bonus when proficient: true", () => {
    // WIS 10 → +0, prof +2, DC 15. Roll 13 + 2 = 15 → success.
    const target = makeTarget(10);
    const dice = new SequenceDiceRoller([13]);
    const res = resolveSaveToEnd(dice, target, holdPersonEffect(15), { proficient: true });
    expect(res.modifier).toBe(2);
    expect(res.success).toBe(true);
  });

  it("applies extra flat bonus (e.g., Paladin Aura)", () => {
    const target = makeTarget(10);
    const dice = new SequenceDiceRoller([10]);
    const res = resolveSaveToEnd(dice, target, holdPersonEffect(15), { bonus: 5 });
    expect(res.modifier).toBe(5);
    expect(res.totalRoll).toBe(15);
    expect(res.success).toBe(true);
  });

  it("honors advantage mode by consuming two dice and picking the higher", () => {
    const target = makeTarget(10);
    const dice = new SequenceDiceRoller([5, 18]);
    const res = resolveSaveToEnd(dice, target, holdPersonEffect(15), { mode: "advantage" });
    expect(res.roll).toBe(18);
    expect(res.success).toBe(true);
  });

  it("throws when the effect has no saveToEnd metadata", () => {
    const target = makeTarget();
    const dice = new SequenceDiceRoller([10]);
    const plain = createEffect("x", "bonus", "saving_throws", "rounds", { value: 1 });
    expect(() => resolveSaveToEnd(dice, target, plain)).toThrow(/saveToEnd/);
  });
});
