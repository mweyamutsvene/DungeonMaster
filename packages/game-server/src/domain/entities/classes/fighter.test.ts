import { describe, expect, it } from "vitest";
import {
  actionSurgeUsesForLevel,
  createActionSurgeState,
  createIndomitableState,
  createSecondWindState,
  indomitableUsesForLevel,
  resetActionSurgeOnShortRest,
  resetIndomitableOnLongRest,
  resetSecondWindOnShortRest,
  spendActionSurge,
  spendIndomitable,
  spendSecondWind,
  secondWindUsesForLevel,
} from "./fighter.js";
import { classHasFeature } from "./registry.js";
import { WEAPON_MASTERY, INDOMITABLE } from "./feature-keys.js";

describe("Fighter resources", () => {
  it("computes action surge uses by level", () => {
    expect(actionSurgeUsesForLevel(1)).toBe(0);
    expect(actionSurgeUsesForLevel(2)).toBe(1);
    expect(actionSurgeUsesForLevel(16)).toBe(1);
    expect(actionSurgeUsesForLevel(17)).toBe(2);
  });

  it("spends and resets action surge on short rest", () => {
    let s = createActionSurgeState(2);
    expect(s.pool.current).toBe(1);

    s = spendActionSurge(s, 1);
    expect(s.pool.current).toBe(0);

    s = resetActionSurgeOnShortRest(2, s);
    expect(s.pool.current).toBe(1);
    expect(s.pool.max).toBe(1);
  });

  it("computes second wind uses by level", () => {
    expect(secondWindUsesForLevel(1)).toBe(1);
    expect(secondWindUsesForLevel(20)).toBe(1);
  });

  it("spends and resets second wind on short rest", () => {
    let s = createSecondWindState(1);
    expect(s.pool.current).toBe(1);

    s = spendSecondWind(s, 1);
    expect(s.pool.current).toBe(0);

    s = resetSecondWindOnShortRest(1, s);
    expect(s.pool.current).toBe(1);
    expect(s.pool.max).toBe(1);
  });
});

describe("Fighter feature keys", () => {
  it("has weapon-mastery at level 1", () => {
    expect(classHasFeature("fighter", WEAPON_MASTERY, 1)).toBe(true);
  });

  it("has indomitable at level 9+", () => {
    expect(classHasFeature("fighter", INDOMITABLE, 8)).toBe(false);
    expect(classHasFeature("fighter", INDOMITABLE, 9)).toBe(true);
    expect(classHasFeature("fighter", INDOMITABLE, 20)).toBe(true);
  });
});

describe("Fighter Indomitable", () => {
  it("computes indomitable uses by level", () => {
    expect(indomitableUsesForLevel(1)).toBe(0);
    expect(indomitableUsesForLevel(8)).toBe(0);
    expect(indomitableUsesForLevel(9)).toBe(1);
    expect(indomitableUsesForLevel(12)).toBe(1);
    expect(indomitableUsesForLevel(13)).toBe(2);
    expect(indomitableUsesForLevel(16)).toBe(2);
    expect(indomitableUsesForLevel(17)).toBe(3);
    expect(indomitableUsesForLevel(20)).toBe(3);
  });

  it("throws for invalid levels", () => {
    expect(() => indomitableUsesForLevel(0)).toThrow();
    expect(() => indomitableUsesForLevel(21)).toThrow();
    expect(() => indomitableUsesForLevel(1.5)).toThrow();
  });

  it("spends and resets indomitable on long rest", () => {
    let s = createIndomitableState(9);
    expect(s.pool.current).toBe(1);
    expect(s.pool.max).toBe(1);

    s = spendIndomitable(s, 1);
    expect(s.pool.current).toBe(0);

    s = resetIndomitableOnLongRest(9, s);
    expect(s.pool.current).toBe(1);
    expect(s.pool.max).toBe(1);
  });

  it("level 13 fighter gets 2 uses", () => {
    const s = createIndomitableState(13);
    expect(s.pool.current).toBe(2);
    expect(s.pool.max).toBe(2);
  });

  it("level 17 fighter gets 3 uses", () => {
    const s = createIndomitableState(17);
    expect(s.pool.current).toBe(3);
    expect(s.pool.max).toBe(3);
  });
});
