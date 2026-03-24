import { describe, expect, it } from "vitest";
import {
  paladinChannelDivinityUsesForLevel,
  createChannelDivinityState,
  createLayOnHandsState,
  layOnHandsPoolForLevel,
  resetChannelDivinityOnShortRest,
  resetLayOnHandsOnLongRest,
  spendChannelDivinity,
  spendLayOnHands,
} from "./paladin.js";

describe("Paladin channel divinity", () => {
  it("computes uses by level", () => {
    expect(paladinChannelDivinityUsesForLevel(2)).toBe(0);
    expect(paladinChannelDivinityUsesForLevel(3)).toBe(1);
    expect(paladinChannelDivinityUsesForLevel(7)).toBe(2);
    expect(paladinChannelDivinityUsesForLevel(18)).toBe(3);
  });

  it("spends and resets on short rest", () => {
    let s = createChannelDivinityState(7);
    expect(s.pool.current).toBe(2);

    s = spendChannelDivinity(s, 2);
    expect(s.pool.current).toBe(0);

    s = resetChannelDivinityOnShortRest(7, s);
    expect(s.pool.current).toBe(2);
    expect(s.pool.max).toBe(2);
  });
});

describe("Paladin lay on hands", () => {
  it("scales pool by level", () => {
    expect(layOnHandsPoolForLevel(1)).toBe(5);
    expect(layOnHandsPoolForLevel(5)).toBe(25);
  });

  it("spends points and resets on long rest", () => {
    let s = createLayOnHandsState(2);
    expect(s.pool.current).toBe(10);

    s = spendLayOnHands(s, 3);
    expect(s.pool.current).toBe(7);

    s = resetLayOnHandsOnLongRest(2, s);
    expect(s.pool.current).toBe(10);
    expect(s.pool.max).toBe(10);
  });
});
