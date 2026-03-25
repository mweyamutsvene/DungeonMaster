import { describe, it, expect } from "vitest";
import { getCantripDamageDice } from "./prepared-spell-definition.js";

describe("getCantripDamageDice", () => {
  it("returns base dice count at levels 1-4", () => {
    expect(getCantripDamageDice(1, 1)).toBe(1);
    expect(getCantripDamageDice(1, 4)).toBe(1);
  });

  it("doubles dice at level 5", () => {
    expect(getCantripDamageDice(1, 5)).toBe(2);
  });

  it("doubles dice at levels 5-10", () => {
    expect(getCantripDamageDice(1, 10)).toBe(2);
  });

  it("triples dice at level 11", () => {
    expect(getCantripDamageDice(1, 11)).toBe(3);
  });

  it("triples dice at levels 11-16", () => {
    expect(getCantripDamageDice(1, 16)).toBe(3);
  });

  it("quadruples dice at level 17", () => {
    expect(getCantripDamageDice(1, 17)).toBe(4);
  });

  it("quadruples dice at level 20", () => {
    expect(getCantripDamageDice(1, 20)).toBe(4);
  });

  it("scales correctly with non-1 base dice count", () => {
    // Some cantrips might have 2 base dice
    expect(getCantripDamageDice(2, 1)).toBe(2);
    expect(getCantripDamageDice(2, 5)).toBe(4);
    expect(getCantripDamageDice(2, 11)).toBe(6);
    expect(getCantripDamageDice(2, 17)).toBe(8);
  });

  it("Fire Bolt at canonical levels: 1d10/2d10/3d10/4d10", () => {
    // Fire Bolt has baseDiceCount=1, diceSides=10
    expect(getCantripDamageDice(1, 1)).toBe(1);   // 1d10
    expect(getCantripDamageDice(1, 5)).toBe(2);   // 2d10
    expect(getCantripDamageDice(1, 11)).toBe(3);  // 3d10
    expect(getCantripDamageDice(1, 17)).toBe(4);  // 4d10
  });
});
