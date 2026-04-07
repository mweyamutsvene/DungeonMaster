import { describe, expect, it } from "vitest";
import { createKiState, kiPointsForLevel, monkUnarmoredDefenseAC, resetKiOnShortRest, spendKi, uncannyMetabolismUsesForLevel, wholenessOfBodyUsesForLevel, getMonkResourcePools } from "./monk.js";
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

describe("uncannyMetabolismUsesForLevel", () => {
  it("returns 0 at level 1", () => {
    expect(uncannyMetabolismUsesForLevel(1)).toBe(0);
  });

  it("returns 1 at level 2+", () => {
    expect(uncannyMetabolismUsesForLevel(2)).toBe(1);
    expect(uncannyMetabolismUsesForLevel(10)).toBe(1);
    expect(uncannyMetabolismUsesForLevel(20)).toBe(1);
  });
});

describe("wholenessOfBodyUsesForLevel", () => {
  it("returns 0 below level 6", () => {
    expect(wholenessOfBodyUsesForLevel(5, 3)).toBe(0);
    expect(wholenessOfBodyUsesForLevel(1, 5)).toBe(0);
  });

  it("returns WIS modifier at level 6+", () => {
    expect(wholenessOfBodyUsesForLevel(6, 2)).toBe(2);
    expect(wholenessOfBodyUsesForLevel(10, 4)).toBe(4);
  });

  it("enforces minimum 1 when WIS mod is 0 or negative", () => {
    expect(wholenessOfBodyUsesForLevel(6, 0)).toBe(1);
    expect(wholenessOfBodyUsesForLevel(6, -1)).toBe(1);
  });
});

describe("getMonkResourcePools", () => {
  it("level 1 has no pools", () => {
    const pools = getMonkResourcePools(1);
    expect(pools).toHaveLength(0);
  });

  it("level 2 has ki and uncanny_metabolism", () => {
    const pools = getMonkResourcePools(2);
    expect(pools.map(p => p.name)).toContain("ki");
    expect(pools.map(p => p.name)).toContain("uncanny_metabolism");
    const um = pools.find(p => p.name === "uncanny_metabolism");
    expect(um?.max).toBe(1);
    expect(um?.current).toBe(1);
  });

  it("level 6 has ki, uncanny_metabolism, and wholeness_of_body (Open Hand)", () => {
    const pools = getMonkResourcePools(6, 3, "open-hand");
    const names = pools.map(p => p.name);
    expect(names).toContain("ki");
    expect(names).toContain("uncanny_metabolism");
    expect(names).toContain("wholeness_of_body");
    const wb = pools.find(p => p.name === "wholeness_of_body");
    expect(wb?.max).toBe(3);
    expect(wb?.current).toBe(3);
  });

  it("level 6 without Open Hand subclass has no wholeness_of_body", () => {
    const pools = getMonkResourcePools(6, 3);
    expect(pools.map(p => p.name)).not.toContain("wholeness_of_body");
  });

  it("level 5 has no wholeness_of_body yet", () => {
    const pools = getMonkResourcePools(5, 3);
    expect(pools.map(p => p.name)).not.toContain("wholeness_of_body");
  });
});
