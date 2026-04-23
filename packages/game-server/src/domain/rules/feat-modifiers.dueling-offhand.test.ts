import { describe, it, expect } from "vitest";

import { shouldApplyDueling } from "./feat-modifiers.js";

describe("shouldApplyDueling — offhand weapon gate", () => {
  const oneHandMelee = { properties: ["Versatile"], hands: 1 as const };

  it("returns false when offhandWeaponEquipped=true (even for a valid 1H melee)", () => {
    expect(
      shouldApplyDueling({ attackKind: "melee", weapon: oneHandMelee, offhandWeaponEquipped: true }),
    ).toBe(false);
  });

  it("returns true when offhandWeaponEquipped=false (classic 1H melee + shield or free hand)", () => {
    expect(
      shouldApplyDueling({ attackKind: "melee", weapon: oneHandMelee, offhandWeaponEquipped: false }),
    ).toBe(true);
  });

  it("returns true when offhandWeaponEquipped is omitted (backward compat)", () => {
    expect(
      shouldApplyDueling({ attackKind: "melee", weapon: oneHandMelee }),
    ).toBe(true);
  });

  it("still returns false for ranged attacks regardless of offhand flag", () => {
    expect(
      shouldApplyDueling({ attackKind: "ranged", weapon: oneHandMelee, offhandWeaponEquipped: false }),
    ).toBe(false);
  });

  it("still returns false for two-handed wielding regardless of offhand flag", () => {
    expect(
      shouldApplyDueling({ attackKind: "melee", weapon: { hands: 2, properties: [] }, offhandWeaponEquipped: false }),
    ).toBe(false);
  });

  it("still returns false for weapons with Two-Handed property regardless of offhand flag", () => {
    expect(
      shouldApplyDueling({ attackKind: "melee", weapon: { hands: 1, properties: ["Two-Handed"] }, offhandWeaponEquipped: false }),
    ).toBe(false);
  });
});
