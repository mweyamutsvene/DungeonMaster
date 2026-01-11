import { describe, expect, it } from "vitest";
import {
  actionSurgeUsesForLevel,
  createActionSurgeState,
  createSecondWindState,
  resetActionSurgeOnShortRest,
  resetSecondWindOnShortRest,
  spendActionSurge,
  spendSecondWind,
  secondWindUsesForLevel,
} from "./fighter.js";

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
