import { describe, expect, it } from "vitest";
import { createKiState, kiPointsForLevel, resetKiOnShortRest, spendKi } from "./monk.js";

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
