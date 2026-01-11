import { describe, expect, it } from "vitest";
import {
  channelDivinityUsesForLevel,
  createChannelDivinityState,
  resetChannelDivinityOnShortRest,
  spendChannelDivinity,
} from "./cleric.js";

describe("Cleric channel divinity", () => {
  it("computes uses by level", () => {
    expect(channelDivinityUsesForLevel(1)).toBe(0);
    expect(channelDivinityUsesForLevel(2)).toBe(1);
    expect(channelDivinityUsesForLevel(6)).toBe(2);
    expect(channelDivinityUsesForLevel(18)).toBe(3);
  });

  it("spends and resets on short rest", () => {
    let s = createChannelDivinityState(6);
    expect(s.pool.current).toBe(2);

    s = spendChannelDivinity(s, 1);
    expect(s.pool.current).toBe(1);

    s = resetChannelDivinityOnShortRest(6, s);
    expect(s.pool.current).toBe(2);
    expect(s.pool.max).toBe(2);
  });
});
