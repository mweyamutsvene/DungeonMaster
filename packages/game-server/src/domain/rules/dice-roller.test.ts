import { describe, expect, it } from "vitest";

import { FixedDiceRoller, SeededDiceRoller } from "./dice-roller.js";

describe("DiceRoller", () => {
  it("FixedDiceRoller returns fixed values", () => {
    const roller = new FixedDiceRoller(7);

    expect(roller.d20().rolls).toEqual([7]);
    expect(roller.d20(3).total).toBe(10);

    const r = roller.rollDie(6, 3, 2);
    expect(r.rolls).toEqual([7, 7, 7]);
    expect(r.total).toBe(23);
  });

  it("SeededDiceRoller is deterministic for the same seed", () => {
    const a = new SeededDiceRoller(123);
    const b = new SeededDiceRoller(123);

    const a1 = a.rollDie(20, 5).rolls;
    const b1 = b.rollDie(20, 5).rolls;

    expect(a1).toEqual(b1);
  });
});
