import { describe, expect, it } from "vitest";
import {
  clericChannelDivinityUsesForLevel,
  createChannelDivinityState,
  resetChannelDivinityOnShortRest,
  spendChannelDivinity,
  getDestroyUndeadCRThreshold,
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

describe("Cleric Destroy Undead", () => {
  it("returns null below level 5", () => {
    expect(getDestroyUndeadCRThreshold(1)).toBeNull();
    expect(getDestroyUndeadCRThreshold(4)).toBeNull();
  });

  it("returns CR 0.5 at level 5-7", () => {
    expect(getDestroyUndeadCRThreshold(5)).toBe(0.5);
    expect(getDestroyUndeadCRThreshold(7)).toBe(0.5);
  });

  it("returns CR 1 at level 8-10", () => {
    expect(getDestroyUndeadCRThreshold(8)).toBe(1);
    expect(getDestroyUndeadCRThreshold(10)).toBe(1);
  });

  it("returns CR 2 at level 11-13", () => {
    expect(getDestroyUndeadCRThreshold(11)).toBe(2);
    expect(getDestroyUndeadCRThreshold(13)).toBe(2);
  });

  it("returns CR 3 at level 14-16", () => {
    expect(getDestroyUndeadCRThreshold(14)).toBe(3);
    expect(getDestroyUndeadCRThreshold(16)).toBe(3);
  });

  it("returns CR 4 at level 17+", () => {
    expect(getDestroyUndeadCRThreshold(17)).toBe(4);
    expect(getDestroyUndeadCRThreshold(20)).toBe(4);
  });
});
