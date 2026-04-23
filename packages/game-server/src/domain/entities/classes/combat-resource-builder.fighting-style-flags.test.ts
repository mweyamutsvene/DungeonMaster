import { describe, it, expect } from "vitest";

import { buildCombatResources } from "./combat-resource-builder.js";

function baseSheet(overrides: Record<string, unknown> = {}): any {
  return {
    className: "Fighter",
    level: 5,
    abilityScores: {
      strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 10,
    },
    ...overrides,
  };
}

describe("buildCombatResources — fighting-style + equipment flags", () => {
  it("populates hasProtectionStyle=true when sheet.fightingStyle === 'protection'", () => {
    const res = buildCombatResources({
      className: "Fighter",
      level: 5,
      sheet: baseSheet({ fightingStyle: "protection" }),
    });
    expect(res.hasProtectionStyle).toBe(true);
    expect(res.hasInterceptionStyle).toBe(false);
  });

  it("populates hasInterceptionStyle=true when sheet.fightingStyle === 'interception'", () => {
    const res = buildCombatResources({
      className: "Fighter",
      level: 5,
      sheet: baseSheet({ fightingStyle: "interception" }),
    });
    expect(res.hasInterceptionStyle).toBe(true);
    expect(res.hasProtectionStyle).toBe(false);
  });

  it("fighting-style flags are false when sheet.fightingStyle is absent or unrelated", () => {
    const none = buildCombatResources({
      className: "Fighter",
      level: 5,
      sheet: baseSheet(),
    });
    expect(none.hasProtectionStyle).toBe(false);
    expect(none.hasInterceptionStyle).toBe(false);

    const other = buildCombatResources({
      className: "Fighter",
      level: 5,
      sheet: baseSheet({ fightingStyle: "defense" }),
    });
    expect(other.hasProtectionStyle).toBe(false);
    expect(other.hasInterceptionStyle).toBe(false);
  });

  it("normalizes fightingStyle casing (case-insensitive)", () => {
    const res = buildCombatResources({
      className: "Fighter",
      level: 5,
      sheet: baseSheet({ fightingStyle: "Protection" }),
    });
    expect(res.hasProtectionStyle).toBe(true);
  });

  it("populates hasShieldEquipped=true from sheet.equippedShield", () => {
    const res = buildCombatResources({
      className: "Fighter",
      level: 5,
      sheet: baseSheet({ equippedShield: { name: "Shield" } }),
    });
    expect(res.hasShieldEquipped).toBe(true);
  });

  it("populates hasShieldEquipped=true from sheet.equipment.shield (fallback)", () => {
    const res = buildCombatResources({
      className: "Fighter",
      level: 5,
      sheet: baseSheet({ equipment: { shield: { name: "Shield" } } }),
    });
    expect(res.hasShieldEquipped).toBe(true);
  });

  it("hasShieldEquipped=false when no shield in sheet", () => {
    const res = buildCombatResources({
      className: "Fighter",
      level: 5,
      sheet: baseSheet(),
    });
    expect(res.hasShieldEquipped).toBe(false);
  });

  it("populates hasWeaponEquipped=true for a main-hand melee weapon", () => {
    const res = buildCombatResources({
      className: "Fighter",
      level: 5,
      sheet: baseSheet({
        equipment: { weapons: [{ name: "Longsword", kind: "melee" }] },
      }),
    });
    expect(res.hasWeaponEquipped).toBe(true);
  });

  it("hasWeaponEquipped=false when the only weapon is offHand", () => {
    const res = buildCombatResources({
      className: "Fighter",
      level: 5,
      sheet: baseSheet({
        equipment: { weapons: [{ name: "Dagger", kind: "melee", offHand: true }] },
      }),
    });
    expect(res.hasWeaponEquipped).toBe(false);
  });

  it("hasWeaponEquipped=false when the only weapon is ranged", () => {
    const res = buildCombatResources({
      className: "Fighter",
      level: 5,
      sheet: baseSheet({
        equipment: { weapons: [{ name: "Longbow", kind: "ranged" }] },
      }),
    });
    expect(res.hasWeaponEquipped).toBe(false);
  });

  it("hasWeaponEquipped=false when weapon.equipped === false", () => {
    const res = buildCombatResources({
      className: "Fighter",
      level: 5,
      sheet: baseSheet({
        equipment: { weapons: [{ name: "Longsword", kind: "melee", equipped: false }] },
      }),
    });
    expect(res.hasWeaponEquipped).toBe(false);
  });

  it("hasWeaponEquipped=false when sheet has no equipment.weapons", () => {
    const res = buildCombatResources({
      className: "Fighter",
      level: 5,
      sheet: baseSheet(),
    });
    expect(res.hasWeaponEquipped).toBe(false);
  });

  it("non-fighter class with fightingStyle still populates flags (not class-gated at builder level)", () => {
    // Gating happens at the reaction detector (classId: "fighter") — not here.
    const res = buildCombatResources({
      className: "Ranger",
      level: 3,
      sheet: baseSheet({ className: "Ranger", level: 3, fightingStyle: "protection", equippedShield: { name: "Shield" } }),
    });
    expect(res.hasProtectionStyle).toBe(true);
    expect(res.hasShieldEquipped).toBe(true);
  });
});
