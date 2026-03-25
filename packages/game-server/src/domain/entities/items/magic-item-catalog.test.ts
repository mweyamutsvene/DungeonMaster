/**
 * Unit tests for magic-item-catalog.ts
 *
 * Covers:
 * - PotionEffect definitions on healing potions (potionEffects.healing)
 * - PotionEffect definitions on Potion of Resistance (potionEffects.effects with resistance)
 * - PotionEffect definitions on Potion of Heroism (tempHp + Bless effects)
 * - lookupMagicItem name lookup (case-insensitive)
 * - lookupMagicItemById ID lookup, including dynamic resistance IDs
 */

import { describe, it, expect } from "vitest";
import {
  lookupMagicItem,
  lookupMagicItemById,
  getAllMagicItems,
} from "./magic-item-catalog.js";

// ─── Healing Potions ─────────────────────────────────────────────────────────

describe("healing potion definitions (potionEffects.healing migration)", () => {
  it("Potion of Healing has potionEffects.healing with 2d4+2 formula", () => {
    const item = lookupMagicItem("Potion of Healing");
    expect(item).toBeDefined();
    expect(item!.potionEffects).toBeDefined();
    expect(item!.potionEffects!.healing).toEqual({
      diceCount: 2,
      diceSides: 4,
      modifier: 2,
    });
    // Should NOT have effects, tempHp, or conditions
    expect(item!.potionEffects!.effects).toBeUndefined();
    expect(item!.potionEffects!.tempHp).toBeUndefined();
  });

  it("Potion of Greater Healing has potionEffects.healing with 4d4+4 formula", () => {
    const item = lookupMagicItem("Potion of Greater Healing");
    expect(item).toBeDefined();
    expect(item!.potionEffects!.healing).toEqual({
      diceCount: 4,
      diceSides: 4,
      modifier: 4,
    });
  });

  it("Potion of Superior Healing has potionEffects.healing with 8d4+8 formula", () => {
    const item = lookupMagicItem("Potion of Superior Healing");
    expect(item!.potionEffects!.healing).toEqual({
      diceCount: 8,
      diceSides: 4,
      modifier: 8,
    });
  });

  it("Potion of Supreme Healing has potionEffects.healing with 10d4+20 formula", () => {
    const item = lookupMagicItem("Potion of Supreme Healing");
    expect(item!.potionEffects!.healing).toEqual({
      diceCount: 10,
      diceSides: 4,
      modifier: 20,
    });
  });

  it("healing potions are categorized as 'potion'", () => {
    for (const name of [
      "Potion of Healing",
      "Potion of Greater Healing",
      "Potion of Superior Healing",
      "Potion of Supreme Healing",
    ]) {
      const item = lookupMagicItem(name);
      expect(item!.category, `${name} should be a potion`).toBe("potion");
    }
  });
});

// ─── Potion of Resistance ────────────────────────────────────────────────────

describe("Potion of Resistance definitions (potionEffects.effects with resistance)", () => {
  it("Potion of Resistance (Fire) has a resistance ActiveEffect for 'fire' damage type", () => {
    const item = lookupMagicItem("Potion of Resistance (Fire)");
    expect(item).toBeDefined();
    expect(item!.potionEffects).toBeDefined();
    expect(item!.potionEffects!.effects).toBeDefined();

    const effects = item!.potionEffects!.effects!;
    expect(effects).toHaveLength(1);

    const effect = effects[0]!;
    expect(effect.type).toBe("resistance");
    expect(effect.damageType).toBe("fire");
    expect(effect.target).toBe("custom");
    expect(effect.duration).toBe("rounds");
    expect(effect.roundsRemaining).toBe(600); // 1 hour
  });

  it("Potion of Resistance (Cold) uses 'cold' damageType", () => {
    const item = lookupMagicItem("Potion of Resistance (Cold)");
    expect(item!.potionEffects!.effects![0]!.damageType).toBe("cold");
  });

  it("Potion of Resistance (Lightning) uses 'lightning' damageType", () => {
    const item = lookupMagicItem("Potion of Resistance (Lightning)");
    expect(item!.potionEffects!.effects![0]!.damageType).toBe("lightning");
  });

  it("Potion of Resistance (Fire) has no healing, tempHp, or conditions", () => {
    const item = lookupMagicItem("Potion of Resistance (Fire)");
    expect(item!.potionEffects!.healing).toBeUndefined();
    expect(item!.potionEffects!.tempHp).toBeUndefined();
    expect(item!.potionEffects!.applyConditions).toBeUndefined();
  });

  it("lookupMagicItemById finds Potion of Resistance (Fire) by ID", () => {
    const item = lookupMagicItemById("potion-of-resistance-fire");
    expect(item).toBeDefined();
    expect(item!.name).toBe("Potion of Resistance (Fire)");
  });

  it("lookupMagicItemById generates dynamic resistance for any damage type", () => {
    const item = lookupMagicItemById("potion-of-resistance-necrotic");
    expect(item).toBeDefined();
    expect(item!.potionEffects!.effects![0]!.damageType).toBe("necrotic");
  });

  it("resistance effects source field contains the potion name", () => {
    const item = lookupMagicItem("Potion of Resistance (Fire)");
    const effect = item!.potionEffects!.effects![0]!;
    expect(effect.source).toContain("Resistance");
    expect(effect.source).toContain("fire");
  });
});

// ─── Potion of Heroism ────────────────────────────────────────────────────────

describe("Potion of Heroism definition (tempHp + Bless effects)", () => {
  it("Potion of Heroism grants 10 temporary HP", () => {
    const item = lookupMagicItem("Potion of Heroism");
    expect(item).toBeDefined();
    expect(item!.potionEffects).toBeDefined();
    expect(item!.potionEffects!.tempHp).toBe(10);
  });

  it("Potion of Heroism has 2 ActiveEffect templates (attack bonus + save bonus)", () => {
    const item = lookupMagicItem("Potion of Heroism");
    const effects = item!.potionEffects!.effects!;
    expect(effects).toHaveLength(2);
  });

  it("Potion of Heroism has a Bless attack roll bonus effect (1d4)", () => {
    const item = lookupMagicItem("Potion of Heroism");
    const effects = item!.potionEffects!.effects!;

    const attackBonus = effects.find(e => e.target === "attack_rolls");
    expect(attackBonus).toBeDefined();
    expect(attackBonus!.type).toBe("bonus");
    expect(attackBonus!.diceValue).toEqual({ count: 1, sides: 4 });
    expect(attackBonus!.duration).toBe("rounds");
    expect(attackBonus!.roundsRemaining).toBe(600);
  });

  it("Potion of Heroism has a Bless saving throw bonus effect (1d4)", () => {
    const item = lookupMagicItem("Potion of Heroism");
    const effects = item!.potionEffects!.effects!;

    const saveBonus = effects.find(e => e.target === "saving_throws");
    expect(saveBonus).toBeDefined();
    expect(saveBonus!.type).toBe("bonus");
    expect(saveBonus!.diceValue).toEqual({ count: 1, sides: 4 });
    expect(saveBonus!.duration).toBe("rounds");
    expect(saveBonus!.roundsRemaining).toBe(600);
  });

  it("Potion of Heroism Bless effects have source 'Potion of Heroism'", () => {
    const item = lookupMagicItem("Potion of Heroism");
    for (const effect of item!.potionEffects!.effects!) {
      expect(effect.source).toBe("Potion of Heroism");
    }
  });

  it("Potion of Heroism has no healing field", () => {
    const item = lookupMagicItem("Potion of Heroism");
    expect(item!.potionEffects!.healing).toBeUndefined();
  });
});

// ─── Catalog integrity ────────────────────────────────────────────────────────

describe("magic item catalog integrity", () => {
  it("lookupMagicItem is case-insensitive", () => {
    expect(lookupMagicItem("potion of healing")).toBeDefined();
    expect(lookupMagicItem("POTION OF HEALING")).toBeDefined();
    expect(lookupMagicItem("Potion Of Healing")).toBeDefined();
  });

  it("lookupMagicItem returns undefined for unknown items", () => {
    expect(lookupMagicItem("Potion of Awesomeness")).toBeUndefined();
  });

  it("lookupMagicItemById returns undefined for unknown IDs", () => {
    expect(lookupMagicItemById("nonexistent-item-id")).toBeUndefined();
  });

  it("all items in the catalog have unique IDs", () => {
    const items = getAllMagicItems();
    const ids = items.map(i => i.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("all potion items have potionEffects defined", () => {
    const items = getAllMagicItems().filter(i => i.category === "potion");
    for (const item of items) {
      expect(item.potionEffects, `${item.name} should have potionEffects`).toBeDefined();
    }
  });
});
