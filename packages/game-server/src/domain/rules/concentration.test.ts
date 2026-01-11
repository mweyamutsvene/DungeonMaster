import { describe, expect, it } from "vitest";

import { FixedDiceRoller } from "./dice-roller.js";
import {
  concentrationCheckOnDamage,
  createConcentrationState,
  endConcentration,
  isConcentrating,
  startConcentration,
} from "./concentration.js";

describe("concentration", () => {
  it("tracks active concentration spell id", () => {
    const s0 = createConcentrationState();
    expect(isConcentrating(s0)).toBe(false);

    const s1 = startConcentration(s0, "spell_a");
    expect(isConcentrating(s1)).toBe(true);
    expect(s1.activeSpellId).toBe("spell_a");

    const s2 = endConcentration(s1);
    expect(isConcentrating(s2)).toBe(false);
  });

  it("concentration check DC uses max(10, floor(damage/2))", () => {
    const dice = new FixedDiceRoller(10);

    const r = concentrationCheckOnDamage(dice, 7, 0);
    expect(r.dc).toBe(10);
    expect(r.maintained).toBe(true);

    const r2 = concentrationCheckOnDamage(dice, 40, 0);
    expect(r2.dc).toBe(20);
    expect(r2.maintained).toBe(false);
  });
});
