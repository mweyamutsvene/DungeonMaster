import { describe, expect, it } from "vitest";

import { FixedDiceRoller, SeededDiceRoller } from "./dice-roller.js";
import { d20Test, rollD20 } from "./advantage.js";

describe("advantage", () => {
  it("rollD20 normal returns a single roll", () => {
    const dice = new FixedDiceRoller(12);
    expect(rollD20(dice, "normal")).toEqual({ rolls: [12], chosen: 12 });
  });

  it("d20Test computes success and natural flags", () => {
    const dice = new FixedDiceRoller(20);
    const r = d20Test(dice, 25, 5, "normal");

    expect(r.total).toBe(25);
    expect(r.success).toBe(true);
    expect(r.natural20).toBe(true);
    expect(r.natural1).toBe(false);
  });

  it("advantage/disadvantage are deterministic with seeded dice", () => {
    const a = new SeededDiceRoller(42);
    const b = new SeededDiceRoller(42);

    const ra = rollD20(a, "advantage");
    const rb = rollD20(b, "advantage");

    expect(ra).toEqual(rb);
  });
});
