import { describe, expect, it } from "vitest";
import { FixedDiceRoller } from "./dice-roller.js";
import { maxHitPoints, computeToughBonusHP } from "./hit-points.js";

describe("hit points", () => {
  it("computes max HP using average method", () => {
    // d8, level 3, con +2 => L1: 8+2=10; L2: (5+2)=7; L3: (5+2)=7; total 24
    expect(
      maxHitPoints({ level: 3, hitDie: 8, constitutionModifier: 2, method: "average" }),
    ).toBe(24);
  });

  it("computes max HP using roll method (deterministic)", () => {
    const dice = new FixedDiceRoller(1);
    // d10, level 2, con 0 => L1: 10; L2 gain: 1; total 11
    expect(
      maxHitPoints({
        level: 2,
        hitDie: 10,
        constitutionModifier: 0,
        method: "roll",
        diceRoller: dice,
      }),
    ).toBe(11);
  });

  describe("computeToughBonusHP", () => {
    it("returns 2 HP per level", () => {
      expect(computeToughBonusHP(1)).toBe(2);
      expect(computeToughBonusHP(5)).toBe(10);
      expect(computeToughBonusHP(10)).toBe(20);
      expect(computeToughBonusHP(20)).toBe(40);
    });
  });
});
