import { describe, expect, it } from "vitest";

import { proficiencyBonusForLevel } from "./proficiency.js";

describe("proficiency", () => {
  it("computes proficiency bonus by level", () => {
    expect(proficiencyBonusForLevel(1)).toBe(2);
    expect(proficiencyBonusForLevel(5)).toBe(3);
    expect(proficiencyBonusForLevel(9)).toBe(4);
    expect(proficiencyBonusForLevel(13)).toBe(5);
    expect(proficiencyBonusForLevel(17)).toBe(6);
  });
});
