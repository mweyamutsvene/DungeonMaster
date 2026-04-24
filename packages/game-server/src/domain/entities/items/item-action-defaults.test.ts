/**
 * Unit tests for item-action-defaults.ts — category defaults + resolve merge.
 */

import { describe, it, expect } from "vitest";
import {
  getCategoryActionCostDefaults,
  resolveItemActionCosts,
} from "./item-action-defaults.js";
import type { MagicItemDefinition } from "./magic-item.js";

describe("getCategoryActionCostDefaults", () => {
  it("potion → use=bonus, give=free-object-interaction, administer=utilize", () => {
    expect(getCategoryActionCostDefaults("potion")).toEqual({
      use: "bonus",
      give: "free-object-interaction",
      administer: "utilize",
    });
  });

  it("weapon → equip=free-object-interaction", () => {
    expect(getCategoryActionCostDefaults("weapon")).toEqual({
      equip: "free-object-interaction",
    });
  });

  it("armor (light) → out-of-combat-only with 1/1 don/doff minutes", () => {
    expect(getCategoryActionCostDefaults("armor", { armorType: "light" })).toEqual({
      equip: "out-of-combat-only",
      donMinutes: 1,
      doffMinutes: 1,
    });
  });

  it("armor (medium) → 5/1 don/doff", () => {
    expect(getCategoryActionCostDefaults("armor", { armorType: "medium" })).toEqual({
      equip: "out-of-combat-only",
      donMinutes: 5,
      doffMinutes: 1,
    });
  });

  it("armor (heavy) → 10/5 don/doff", () => {
    expect(getCategoryActionCostDefaults("armor", { armorType: "heavy" })).toEqual({
      equip: "out-of-combat-only",
      donMinutes: 10,
      doffMinutes: 5,
    });
  });

  it("armor (shield) → equip=utilize (no don/doff minutes)", () => {
    expect(getCategoryActionCostDefaults("armor", { armorType: "shield" })).toEqual({
      equip: "utilize",
    });
  });

  it("wondrous-item → use=utilize, give=free-object-interaction", () => {
    expect(getCategoryActionCostDefaults("wondrous-item")).toEqual({
      use: "utilize",
      give: "free-object-interaction",
    });
  });

  it("wand / staff / rod / ring → generic magic item defaults", () => {
    const expected = { use: "utilize", give: "free-object-interaction" };
    expect(getCategoryActionCostDefaults("wand")).toEqual(expected);
    expect(getCategoryActionCostDefaults("staff")).toEqual(expected);
    expect(getCategoryActionCostDefaults("rod")).toEqual(expected);
    expect(getCategoryActionCostDefaults("ring")).toEqual(expected);
  });
});

describe("resolveItemActionCosts", () => {
  it("per-item overrides win field-by-field over category defaults", () => {
    const goodberry: Pick<MagicItemDefinition, "category" | "actionCosts" | "baseArmor"> = {
      category: "potion",
      actionCosts: { administer: "bonus" }, // Goodberry spell text override
    };
    expect(resolveItemActionCosts(goodberry)).toEqual({
      use: "bonus",
      give: "free-object-interaction",
      administer: "bonus", // overridden
    });
  });

  it("infers armorType from baseArmor slug (plate → heavy)", () => {
    const plate: Pick<MagicItemDefinition, "category" | "actionCosts" | "baseArmor"> = {
      category: "armor",
      baseArmor: "Plate",
    };
    expect(resolveItemActionCosts(plate)).toEqual({
      equip: "out-of-combat-only",
      donMinutes: 10,
      doffMinutes: 5,
    });
  });

  it("infers shield from baseArmor = 'Shield'", () => {
    const shield: Pick<MagicItemDefinition, "category" | "actionCosts" | "baseArmor"> = {
      category: "armor",
      baseArmor: "Shield",
    };
    expect(resolveItemActionCosts(shield)).toEqual({ equip: "utilize" });
  });

  it("explicit armorType hint wins over inference", () => {
    const custom: Pick<MagicItemDefinition, "category" | "actionCosts" | "baseArmor"> = {
      category: "armor",
      baseArmor: "Plate",
    };
    expect(resolveItemActionCosts(custom, { armorType: "light" })).toEqual({
      equip: "out-of-combat-only",
      donMinutes: 1,
      doffMinutes: 1,
    });
  });

  it("unknown baseArmor falls back to heavy defaults", () => {
    const unknown: Pick<MagicItemDefinition, "category" | "actionCosts" | "baseArmor"> = {
      category: "armor",
      baseArmor: "Mythril Weave",
    };
    expect(resolveItemActionCosts(unknown)).toEqual({
      equip: "out-of-combat-only",
      donMinutes: 10,
      doffMinutes: 5,
    });
  });

  it("returns category defaults when no actionCosts on item", () => {
    const potion: Pick<MagicItemDefinition, "category" | "actionCosts" | "baseArmor"> = {
      category: "potion",
    };
    expect(resolveItemActionCosts(potion)).toEqual({
      use: "bonus",
      give: "free-object-interaction",
      administer: "utilize",
    });
  });
});
