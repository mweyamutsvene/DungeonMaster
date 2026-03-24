import { describe, expect, it } from "vitest";
import {
  clericChannelDivinityUsesForLevel,
  createChannelDivinityState,
  resetChannelDivinityOnShortRest,
  spendChannelDivinity,
} from "./cleric.js";

describe("Cleric channel divinity", () => {
  it("computes uses by level (2024 rules)", () => {
    expect(clericChannelDivinityUsesForLevel(1)).toBe(0);
    expect(clericChannelDivinityUsesForLevel(2)).toBe(2);
    expect(clericChannelDivinityUsesForLevel(6)).toBe(3);
    expect(clericChannelDivinityUsesForLevel(18)).toBe(4);
  });

  it("spends and resets on short rest", () => {
    let s = createChannelDivinityState(6);
    expect(s.pool.current).toBe(3);

    s = spendChannelDivinity(s, 1);
    expect(s.pool.current).toBe(2);

    s = resetChannelDivinityOnShortRest(6, s);
    expect(s.pool.current).toBe(3);
    expect(s.pool.max).toBe(3);
  });
});
