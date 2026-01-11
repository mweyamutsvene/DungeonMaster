import { describe, expect, it } from "vitest";

import { AbilityScores } from "./ability-scores.js";

describe("AbilityScores", () => {
  it("computes modifiers using floor((score-10)/2)", () => {
    const scores = new AbilityScores({
      strength: 10,
      dexterity: 12,
      constitution: 9,
      intelligence: 18,
      wisdom: 1,
      charisma: 20,
    });

    expect(scores.getModifier("strength")).toBe(0);
    expect(scores.getModifier("dexterity")).toBe(1);
    expect(scores.getModifier("constitution")).toBe(-1);
    expect(scores.getModifier("intelligence")).toBe(4);
    expect(scores.getModifier("wisdom")).toBe(-5);
    expect(scores.getModifier("charisma")).toBe(5);
  });

  it("rejects setting scores < 1", () => {
    const scores = new AbilityScores({
      strength: 10,
      dexterity: 10,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
    });

    expect(() => scores.setScore("wisdom", 0)).toThrow();
  });
});
