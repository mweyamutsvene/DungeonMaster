import { describe, it, expect } from "vitest";
import { buildCombatResources } from "./combat-resource-builder.js";
import { getMonkResourcePools, wholenessOfBodyUsesForLevel, uncannyMetabolismUsesForLevel } from "./monk.js";

// ----- Monk pool helpers -----

describe("Monk resource pool helpers", () => {
  it("uncannyMetabolismUsesForLevel returns 0 below level 2", () => {
    expect(uncannyMetabolismUsesForLevel(1)).toBe(0);
  });

  it("uncannyMetabolismUsesForLevel returns 1 at level 2+", () => {
    expect(uncannyMetabolismUsesForLevel(2)).toBe(1);
    expect(uncannyMetabolismUsesForLevel(10)).toBe(1);
  });

  it("wholenessOfBodyUsesForLevel returns 0 below level 6", () => {
    expect(wholenessOfBodyUsesForLevel(5)).toBe(0);
  });

  it("wholenessOfBodyUsesForLevel returns WIS mod (min 1) at level 6+", () => {
    expect(wholenessOfBodyUsesForLevel(6, 0)).toBe(1);  // WIS mod 0 → min 1
    expect(wholenessOfBodyUsesForLevel(6, 3)).toBe(3);  // WIS mod 3
    expect(wholenessOfBodyUsesForLevel(6, -1)).toBe(1); // WIS mod -1 → min 1
  });

  it("getMonkResourcePools returns ki + uncanny_metabolism at level 2", () => {
    const pools = getMonkResourcePools(2);
    expect(pools.find(p => p.name === "ki")).toEqual({ name: "ki", current: 2, max: 2 });
    expect(pools.find(p => p.name === "uncanny_metabolism")).toEqual({ name: "uncanny_metabolism", current: 1, max: 1 });
    expect(pools.find(p => p.name === "wholeness_of_body")).toBeUndefined();
  });

  it("getMonkResourcePools includes wholeness_of_body at level 6+", () => {
    const pools = getMonkResourcePools(6, 2); // WIS mod 2
    expect(pools.find(p => p.name === "wholeness_of_body")).toEqual({ name: "wholeness_of_body", current: 2, max: 2 });
  });

  it("getMonkResourcePools returns empty for level 1", () => {
    const pools = getMonkResourcePools(1);
    expect(pools).toEqual([]);
  });
});

// ----- buildCombatResources -----

describe("buildCombatResources", () => {
  it("builds Fighter resources with Action Surge and Second Wind", () => {
    const result = buildCombatResources({
      className: "Fighter",
      level: 5,
      sheet: { abilityScores: { strength: 16, dexterity: 12 } } as any,
    });

    expect(result.resourcePools.find(p => p.name === "actionSurge")).toEqual({ name: "actionSurge", current: 1, max: 1 });
    expect(result.resourcePools.find(p => p.name === "secondWind")).toEqual({ name: "secondWind", current: 1, max: 1 });
    expect(result.hasShieldPrepared).toBe(false);
  });

  it("builds Monk resources with ki, uncanny_metabolism", () => {
    const result = buildCombatResources({
      className: "Monk",
      level: 3,
      sheet: { abilityScores: { wisdom: 14, dexterity: 16 } } as any,
    });

    expect(result.resourcePools.find(p => p.name === "ki")).toEqual({ name: "ki", current: 3, max: 3 });
    expect(result.resourcePools.find(p => p.name === "uncanny_metabolism")).toEqual({ name: "uncanny_metabolism", current: 1, max: 1 });
  });

  it("builds Monk resources with wholeness_of_body at level 6", () => {
    const result = buildCombatResources({
      className: "Monk",
      level: 6,
      sheet: { abilityScores: { wisdom: 16, dexterity: 16 } } as any,
    });

    expect(result.resourcePools.find(p => p.name === "wholeness_of_body")).toEqual({ name: "wholeness_of_body", current: 3, max: 3 });
  });

  it("builds spell slot pools from sheet", () => {
    const result = buildCombatResources({
      className: "Wizard",
      level: 3,
      sheet: {
        abilityScores: { intelligence: 16 },
        spellSlots: { "1": 4, "2": 2 },
      } as any,
    });

    expect(result.resourcePools.find(p => p.name === "spellSlot_1")).toEqual({ name: "spellSlot_1", current: 4, max: 4 });
    expect(result.resourcePools.find(p => p.name === "spellSlot_2")).toEqual({ name: "spellSlot_2", current: 2, max: 2 });
  });

  it("detects Shield spell prepared", () => {
    const result = buildCombatResources({
      className: "Wizard",
      level: 1,
      sheet: {
        preparedSpells: [{ name: "Shield" }, { name: "Magic Missile" }],
      } as any,
    });

    expect(result.hasShieldPrepared).toBe(true);
  });

  it("does not flag Shield when not prepared", () => {
    const result = buildCombatResources({
      className: "Wizard",
      level: 1,
      sheet: {
        preparedSpells: [{ name: "Magic Missile" }],
      } as any,
    });

    expect(result.hasShieldPrepared).toBe(false);
  });

  it("returns empty pools for unknown class", () => {
    const result = buildCombatResources({
      className: "Homebrew",
      level: 5,
      sheet: {} as any,
    });

    expect(result.resourcePools).toEqual([]);
  });

  it("merges sheet-level resource pools that aren't class-defined", () => {
    const result = buildCombatResources({
      className: "Fighter",
      level: 2,
      sheet: {
        resourcePools: [{ name: "customPool", current: 3, max: 3 }],
      } as any,
    });

    expect(result.resourcePools.find(p => p.name === "customPool")).toEqual({ name: "customPool", current: 3, max: 3 });
    // Class pools still present
    expect(result.resourcePools.find(p => p.name === "actionSurge")).toBeDefined();
  });

  it("builds Bard resources with bardicInspiration pool using CHA modifier", () => {
    const result = buildCombatResources({
      className: "Bard",
      level: 5,
      sheet: { abilityScores: { charisma: 16 } } as any, // CHA mod = +3
    });

    expect(result.resourcePools.find(p => p.name === "bardicInspiration")).toEqual({
      name: "bardicInspiration",
      current: 3,
      max: 3,
    });
  });

  it("builds Bard bardicInspiration with minimum 1 use for low CHA", () => {
    const result = buildCombatResources({
      className: "Bard",
      level: 1,
      sheet: { abilityScores: { charisma: 8 } } as any, // CHA mod = -1
    });

    expect(result.resourcePools.find(p => p.name === "bardicInspiration")).toEqual({
      name: "bardicInspiration",
      current: 1,
      max: 1,
    });
  });
});
