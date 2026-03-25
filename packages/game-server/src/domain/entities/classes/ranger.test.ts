import { describe, expect, it } from "vitest";
import { classHasFeature } from "./registry.js";
import { WEAPON_MASTERY } from "./feature-keys.js";

describe("Ranger features", () => {
  it("gates major features by level (up to 5) via features map", () => {
    expect(classHasFeature("ranger", "spellcasting", 1)).toBe(false);
    expect(classHasFeature("ranger", "extra-attack", 1)).toBe(false);

    expect(classHasFeature("ranger", "spellcasting", 2)).toBe(true);
    expect(classHasFeature("ranger", "extra-attack", 2)).toBe(false);

    expect(classHasFeature("ranger", "extra-attack", 4)).toBe(false);
    expect(classHasFeature("ranger", "extra-attack", 5)).toBe(true);
  });

  it("has weapon-mastery at level 1", () => {
    expect(classHasFeature("ranger", WEAPON_MASTERY, 1)).toBe(true);
  });
});
