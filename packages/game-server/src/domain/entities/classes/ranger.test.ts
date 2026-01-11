import { describe, expect, it } from "vitest";
import {
  hasRangerExtraAttackAtLevel,
  hasRangerFightingStyleAtLevel,
  hasRangerSpellcastingAtLevel,
  hasRangerSubclassAtLevel,
} from "./ranger.js";

describe("Ranger features", () => {
  it("gates major features by level (up to 5)", () => {
    expect(hasRangerFightingStyleAtLevel(1)).toBe(false);
    expect(hasRangerSpellcastingAtLevel(1)).toBe(false);
    expect(hasRangerSubclassAtLevel(1)).toBe(false);
    expect(hasRangerExtraAttackAtLevel(1)).toBe(false);

    expect(hasRangerFightingStyleAtLevel(2)).toBe(true);
    expect(hasRangerSpellcastingAtLevel(2)).toBe(true);
    expect(hasRangerSubclassAtLevel(2)).toBe(false);
    expect(hasRangerExtraAttackAtLevel(2)).toBe(false);

    expect(hasRangerSubclassAtLevel(3)).toBe(true);
    expect(hasRangerExtraAttackAtLevel(4)).toBe(false);
    expect(hasRangerExtraAttackAtLevel(5)).toBe(true);
  });
});
