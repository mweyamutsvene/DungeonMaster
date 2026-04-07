import { describe, it, expect } from "vitest";
import {
  computeFeatModifiers,
  FEAT_LUCKY,
  FEAT_TOUGH,
} from "./feat-modifiers.js";
import { maxHitPoints } from "./hit-points.js";
import { resetLuckyPoints, LUCKY_POINTS_MAX } from "./lucky.js";

describe("RULES-L2: Tough feat — max HP bonus", () => {
  it("adds +10 max HP at level 5 when toughEnabled", () => {
    // d8 fighter, average method, CON +1, level 5
    const withoutTough = maxHitPoints({
      level: 5,
      hitDie: 8,
      constitutionModifier: 1,
      method: "average",
    });
    const withTough = maxHitPoints({
      level: 5,
      hitDie: 8,
      constitutionModifier: 1,
      method: "average",
      toughEnabled: true,
    });

    // Tough adds 2 HP per level → 5 * 2 = 10
    expect(withTough - withoutTough).toBe(10);
  });

  it("does not add HP bonus when toughEnabled is false", () => {
    const withoutTough = maxHitPoints({
      level: 5,
      hitDie: 8,
      constitutionModifier: 0,
      method: "average",
    });
    const withToughFalse = maxHitPoints({
      level: 5,
      hitDie: 8,
      constitutionModifier: 0,
      method: "average",
      toughEnabled: false,
    });

    expect(withToughFalse - withoutTough).toBe(0);
  });

  it("computeFeatModifiers sets toughEnabled: true when FEAT_TOUGH is present", () => {
    const mods = computeFeatModifiers([FEAT_TOUGH]);
    expect(mods.toughEnabled).toBe(true);
  });

  it("computeFeatModifiers sets toughEnabled: false when FEAT_TOUGH is absent", () => {
    const mods = computeFeatModifiers([]);
    expect(mods.toughEnabled).toBe(false);
  });
});

describe("RULES-L1: Lucky feat — luck points", () => {
  it("initializes luckPoints to 3 when luckyEnabled", () => {
    const mods = computeFeatModifiers([FEAT_LUCKY]);
    expect(mods.luckyEnabled).toBe(true);
    expect(mods.luckPoints).toBe(LUCKY_POINTS_MAX);
    expect(mods.luckPoints).toBe(3);
  });

  it("does not set luckPoints when feat is absent", () => {
    const mods = computeFeatModifiers([]);
    expect(mods.luckyEnabled).toBe(false);
    expect(mods.luckPoints).toBeUndefined();
  });

  it("resetLuckyPoints returns 3 (long rest restores all luck points)", () => {
    const restored = resetLuckyPoints();
    expect(restored).toBe(3);
    expect(restored).toBe(LUCKY_POINTS_MAX);
  });

  it("resetLuckyPoints always returns 3 regardless of current state", () => {
    expect(resetLuckyPoints()).toBe(3);
  });
});
