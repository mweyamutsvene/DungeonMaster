import { describe, expect, it } from "vitest";
import {
  createRageState,
  endRage,
  rageUsesForLevel,
  resetRageOnLongRest,
  startRage,
} from "./barbarian.js";

describe("Barbarian rage", () => {
  it("computes rage uses by level", () => {
    expect(rageUsesForLevel(1)).toBe(2);
    expect(rageUsesForLevel(3)).toBe(3);
    expect(rageUsesForLevel(6)).toBe(4);
    expect(rageUsesForLevel(12)).toBe(5);
    expect(rageUsesForLevel(17)).toBe(6);
  });

  it("spends a rage use when starting rage", () => {
    let s = createRageState(1);
    expect(s.pool.current).toBe(2);

    s = startRage(s);
    expect(s.active).toBe(true);
    expect(s.pool.current).toBe(1);

    s = endRage(s);
    expect(s.active).toBe(false);
    expect(s.pool.current).toBe(1);

    s = resetRageOnLongRest(1, s);
    expect(s.active).toBe(false);
    expect(s.pool.current).toBe(2);
    expect(s.pool.max).toBe(2);
  });
});
