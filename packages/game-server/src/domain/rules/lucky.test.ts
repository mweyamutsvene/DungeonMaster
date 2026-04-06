import { describe, it, expect } from "vitest";
import {
  canUseLucky,
  useLuckyPoint,
  resetLuckyPoints,
  LUCKY_POINTS_MAX,
} from "./lucky.js";

describe("Lucky feat foundation", () => {
  it("can use Lucky when points > 0", () => {
    expect(canUseLucky(3)).toBe(true);
    expect(canUseLucky(1)).toBe(true);
  });

  it("cannot use Lucky when points = 0", () => {
    expect(canUseLucky(0)).toBe(false);
  });

  it("useLuckyPoint decrements by 1", () => {
    expect(useLuckyPoint(3)).toBe(2);
    expect(useLuckyPoint(1)).toBe(0);
  });

  it("useLuckyPoint never goes below 0", () => {
    expect(useLuckyPoint(0)).toBe(0);
  });

  it("resetLuckyPoints returns the max (3)", () => {
    expect(resetLuckyPoints()).toBe(3);
    expect(resetLuckyPoints()).toBe(LUCKY_POINTS_MAX);
  });
});
