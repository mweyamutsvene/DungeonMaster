import { describe, expect, it } from "vitest";

import { FixedDiceRoller } from "./dice-roller.js";
import { resolveToHit } from "./combat-rules.js";

describe("combat-rules", () => {
  it("resolveToHit hits when total >= AC", () => {
    const dice = new FixedDiceRoller(12);
    const r = resolveToHit(dice, 14, 3);
    expect(r.totalToHit).toBe(15);
    expect(r.hit).toBe(true);
    expect(r.critical).toBe(false);
  });

  it("resolveToHit always hits on natural 20", () => {
    const dice = new FixedDiceRoller(20);
    const r = resolveToHit(dice, 100, -5);
    expect(r.hit).toBe(true);
    expect(r.critical).toBe(true);
  });
});
