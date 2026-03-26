import { describe, it, expect } from "vitest";
import { applyEvasion, creatureHasEvasion } from "./evasion.js";

describe("applyEvasion", () => {
  describe("without Evasion (normal behavior)", () => {
    it("full damage on failed save", () => {
      expect(applyEvasion(20, false, false)).toBe(20);
    });

    it("half damage on successful save (halfOnSave = true)", () => {
      expect(applyEvasion(20, true, false, true)).toBe(10);
    });

    it("zero damage on successful save (halfOnSave = false)", () => {
      expect(applyEvasion(20, true, false, false)).toBe(0);
    });

    it("floors half damage", () => {
      expect(applyEvasion(15, true, false)).toBe(7);
    });
  });

  describe("with Evasion", () => {
    it("zero damage on successful save", () => {
      expect(applyEvasion(20, true, true)).toBe(0);
    });

    it("half damage on failed save", () => {
      expect(applyEvasion(20, false, true)).toBe(10);
    });

    it("floors half damage on failed save", () => {
      expect(applyEvasion(15, false, true)).toBe(7);
    });

    it("ignores halfOnSave parameter — always 0 on success", () => {
      expect(applyEvasion(20, true, true, false)).toBe(0);
      expect(applyEvasion(20, true, true, true)).toBe(0);
    });

    it("ignores halfOnSave parameter — always half on failure", () => {
      expect(applyEvasion(20, false, true, false)).toBe(10);
      expect(applyEvasion(20, false, true, true)).toBe(10);
    });
  });

  describe("edge cases", () => {
    it("0 damage remains 0 regardless of evasion", () => {
      expect(applyEvasion(0, true, true)).toBe(0);
      expect(applyEvasion(0, false, true)).toBe(0);
      expect(applyEvasion(0, true, false)).toBe(0);
      expect(applyEvasion(0, false, false)).toBe(0);
    });

    it("1 damage halved floors to 0", () => {
      expect(applyEvasion(1, true, false)).toBe(0);
      expect(applyEvasion(1, false, true)).toBe(0);
    });
  });
});

describe("creatureHasEvasion", () => {
  it("monk level 7+ has Evasion", () => {
    expect(creatureHasEvasion("monk", 7)).toBe(true);
    expect(creatureHasEvasion("Monk", 10)).toBe(true);
  });

  it("monk below level 7 does not have Evasion", () => {
    expect(creatureHasEvasion("monk", 6)).toBe(false);
  });

  it("rogue level 7+ has Evasion", () => {
    expect(creatureHasEvasion("rogue", 7)).toBe(true);
    expect(creatureHasEvasion("Rogue", 15)).toBe(true);
  });

  it("rogue below level 7 does not have Evasion", () => {
    expect(creatureHasEvasion("rogue", 6)).toBe(false);
  });

  it("fighter does not have Evasion", () => {
    expect(creatureHasEvasion("fighter", 20)).toBe(false);
  });

  it("undefined className returns false", () => {
    expect(creatureHasEvasion(undefined, 10)).toBe(false);
  });

  it("empty className returns false", () => {
    expect(creatureHasEvasion("", 10)).toBe(false);
  });
});
