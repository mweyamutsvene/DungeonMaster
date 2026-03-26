import { describe, expect, it } from "vitest";
import {
  bardicInspirationDieForLevel,
  bardicInspirationUsesForLevel,
  createBardicInspirationState,
  resetBardicInspirationOnRest,
  spendBardicInspiration,
  Bard,
} from "./bard.js";

describe("Bardic inspiration", () => {
  it("scales inspiration die by level", () => {
    expect(bardicInspirationDieForLevel(1)).toBe(6);
    expect(bardicInspirationDieForLevel(5)).toBe(8);
    expect(bardicInspirationDieForLevel(10)).toBe(10);
    expect(bardicInspirationDieForLevel(15)).toBe(12);
  });

  it("uses equal CHA mod (min 1)", () => {
    expect(bardicInspirationUsesForLevel(1, -1)).toBe(1);
    expect(bardicInspirationUsesForLevel(1, 0)).toBe(1);
    expect(bardicInspirationUsesForLevel(1, 3)).toBe(3);
  });

  it("spends and resets on correct rest type", () => {
    let s = createBardicInspirationState(4, 3);
    expect(s.pool.current).toBe(3);

    s = spendBardicInspiration(s, 2);
    expect(s.pool.current).toBe(1);

    // Pre-5: short rest does not refresh.
    const shortRestNoRefresh = resetBardicInspirationOnRest(4, 3, s, "short");
    expect(shortRestNoRefresh.pool.current).toBe(1);

    const longRestRefresh = resetBardicInspirationOnRest(4, 3, s, "long");
    expect(longRestRefresh.pool.current).toBe(3);

    // 5+: short rest refreshes.
    const at5 = createBardicInspirationState(5, 2);
    const spent = spendBardicInspiration(at5, 1);
    const shortRestRefresh = resetBardicInspirationOnRest(5, 2, spent, "short");
    expect(shortRestRefresh.pool.current).toBe(2);
  });
});

describe("Bard.resourcesAtLevel", () => {
  it("returns bardicInspiration pool using CHA modifier", () => {
    const pools = Bard.resourcesAtLevel!(3, { charisma: 3 });
    expect(pools).toEqual([{ name: "bardicInspiration", current: 3, max: 3 }]);
  });

  it("returns minimum 1 use when CHA modifier is 0 or negative", () => {
    const pools = Bard.resourcesAtLevel!(1, { charisma: -1 });
    expect(pools).toEqual([{ name: "bardicInspiration", current: 1, max: 1 }]);
  });

  it("defaults CHA modifier to 0 when abilityModifiers omitted", () => {
    const pools = Bard.resourcesAtLevel!(1);
    expect(pools).toEqual([{ name: "bardicInspiration", current: 1, max: 1 }]);
  });
});
