import { describe, expect, it } from "vitest";
import {
  createWildShapeState,
  resetWildShapeOnShortRest,
  spendWildShape,
  wildShapeMaxCRForLevel,
  wildShapeUsesForLevel,
} from "./druid.js";

describe("Druid wild shape", () => {
  it("gates uses by level", () => {
    expect(wildShapeUsesForLevel(1)).toBe(0);
    expect(wildShapeUsesForLevel(2)).toBe(2);
    expect(wildShapeUsesForLevel(5)).toBe(2);
  });

  it("computes max CR by level (up to 5)", () => {
    expect(wildShapeMaxCRForLevel(1)).toBe(0);
    expect(wildShapeMaxCRForLevel(2)).toBe(0.25);
    expect(wildShapeMaxCRForLevel(4)).toBe(0.5);
    expect(wildShapeMaxCRForLevel(5)).toBe(0.5);
  });

  it("spends and resets on short rest", () => {
    let s = createWildShapeState(2);
    expect(s.pool.current).toBe(2);

    s = spendWildShape(s, 1);
    expect(s.pool.current).toBe(1);

    s = resetWildShapeOnShortRest(2, s);
    expect(s.pool.current).toBe(2);
    expect(s.pool.max).toBe(2);
  });
});
