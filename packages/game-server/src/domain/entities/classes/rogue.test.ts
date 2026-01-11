import { describe, expect, it } from "vitest";
import { sneakAttackDiceForLevel } from "./rogue.js";

describe("Rogue sneak attack", () => {
  it("scales sneak attack dice by level", () => {
    expect(sneakAttackDiceForLevel(1)).toBe(1);
    expect(sneakAttackDiceForLevel(2)).toBe(1);
    expect(sneakAttackDiceForLevel(3)).toBe(2);
    expect(sneakAttackDiceForLevel(5)).toBe(3);
    expect(sneakAttackDiceForLevel(19)).toBe(10);
    expect(sneakAttackDiceForLevel(20)).toBe(10);
  });
});
