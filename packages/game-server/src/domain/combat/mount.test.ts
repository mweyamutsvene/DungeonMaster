/**
 * Tests for mounted combat domain helpers.
 */

import { describe, it, expect } from "vitest";
import { canMount, getMountingCost } from "./mount.js";

describe("canMount", () => {
  it("allows Medium rider on Large mount", () => {
    expect(canMount("Medium", "Large")).toBe(true);
  });

  it("allows Small rider on Medium mount", () => {
    expect(canMount("Small", "Medium")).toBe(true);
  });

  it("allows Tiny rider on Small mount", () => {
    expect(canMount("Tiny", "Small")).toBe(true);
  });

  it("allows Small rider on Huge mount (2+ sizes larger)", () => {
    expect(canMount("Small", "Huge")).toBe(true);
  });

  it("rejects Medium rider on Medium mount (same size)", () => {
    expect(canMount("Medium", "Medium")).toBe(false);
  });

  it("rejects Large rider on Medium mount (mount smaller)", () => {
    expect(canMount("Large", "Medium")).toBe(false);
  });

  it("rejects Medium rider on Small mount", () => {
    expect(canMount("Medium", "Small")).toBe(false);
  });
});

describe("getMountingCost", () => {
  it("returns half speed for 30 ft", () => {
    expect(getMountingCost(30)).toBe(15);
  });

  it("returns half speed for 25 ft (rounds down)", () => {
    expect(getMountingCost(25)).toBe(12);
  });

  it("returns 0 for 0 speed", () => {
    expect(getMountingCost(0)).toBe(0);
  });
});
