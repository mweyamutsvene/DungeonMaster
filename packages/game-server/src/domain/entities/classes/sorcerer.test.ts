import { describe, expect, it } from "vitest";
import {
  createSorceryPointsState,
  resetSorceryPointsOnLongRest,
  sorceryPointsForLevel,
  spendSorceryPoints,
} from "./sorcerer.js";

describe("Sorcerer sorcery points", () => {
  it("computes sorcery points by level", () => {
    expect(sorceryPointsForLevel(1)).toBe(0);
    expect(sorceryPointsForLevel(2)).toBe(2);
    expect(sorceryPointsForLevel(10)).toBe(10);
    expect(sorceryPointsForLevel(20)).toBe(20);
  });

  it("spends and resets sorcery points", () => {
    let s = createSorceryPointsState(6);
    expect(s.pool.current).toBe(6);

    s = spendSorceryPoints(s, 5);
    expect(s.pool.current).toBe(1);

    s = resetSorceryPointsOnLongRest(6, s);
    expect(s.pool.current).toBe(6);
    expect(s.pool.max).toBe(6);
  });
});
