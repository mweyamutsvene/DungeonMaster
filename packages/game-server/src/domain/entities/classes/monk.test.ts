import { describe, expect, it } from "vitest";
import { createKiState, kiPointsForLevel, monkUnarmoredDefenseAC, resetKiOnShortRest, spendKi } from "./monk.js";
import { classHasFeature } from "./registry.js";
import { EVASION } from "./feature-keys.js";

describe("Monk ki", () => {
  it("computes ki points by level", () => {
    expect(kiPointsForLevel(1)).toBe(0);
    expect(kiPointsForLevel(2)).toBe(2);
    expect(kiPointsForLevel(5)).toBe(5);
    expect(kiPointsForLevel(20)).toBe(20);
  });

  it("spends and resets ki", () => {
    let s = createKiState(5);
    expect(s.pool.current).toBe(5);

    s = spendKi(s, 2);
    expect(s.pool.current).toBe(3);

    s = resetKiOnShortRest(5, s);
    expect(s.pool.current).toBe(5);
    expect(s.pool.max).toBe(5);
  });
});

describe("Monk feature keys", () => {
  it("has evasion at level 7", () => {
    expect(classHasFeature("monk", EVASION, 7)).toBe(true);
    expect(classHasFeature("monk", EVASION, 6)).toBe(false);
  });
});

describe("monkUnarmoredDefenseAC", () => {
  it("computes 10 + DEX + WIS", () => {
    expect(monkUnarmoredDefenseAC(0, 0)).toBe(10);
    expect(monkUnarmoredDefenseAC(3, 2)).toBe(15);
    expect(monkUnarmoredDefenseAC(5, 3)).toBe(18);
  });

  it("handles negative modifiers", () => {
    expect(monkUnarmoredDefenseAC(-1, -1)).toBe(8);
    expect(monkUnarmoredDefenseAC(2, -1)).toBe(11);
  });

  it("single high modifier", () => {
    expect(monkUnarmoredDefenseAC(0, 5)).toBe(15);
    expect(monkUnarmoredDefenseAC(4, 0)).toBe(14);
  });
});
