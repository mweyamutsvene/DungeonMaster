import { describe, it, expect } from "vitest";
import {
  lookupWeapon,
  getAllWeapons,
  hasWeaponProperty,
  getWeaponProperties,
  parseThrownRange,
  getWeaponThrownRange,
} from "./weapon-catalog.js";
import {
  hasProperty,
  isFinesse,
  isLight,
  isHeavy,
  isThrown,
  isLoading,
  isReach,
  isVersatile,
  isTwoHanded,
  usesAmmunition,
} from "./weapon-properties.js";
import { lookupArmor, getAllArmor } from "./armor-catalog.js";
import {
  lookupMagicItem,
  lookupMagicItemById,
  getAllMagicItems,
  bonusWeapon,
  bonusArmor,
} from "./magic-item-catalog.js";

// ═══════════════════════════════════════════════════════════════════════════
// Weapon Catalog
// ═══════════════════════════════════════════════════════════════════════════

describe("weapon catalog", () => {
  it("contains all standard D&D 5e weapons", () => {
    const all = getAllWeapons();
    // 10 simple melee + 4 simple ranged + 18 martial melee + 6 martial ranged = 38
    expect(all.length).toBe(38);
  });

  it("looks up weapons case-insensitively", () => {
    expect(lookupWeapon("Longsword")).toBeDefined();
    expect(lookupWeapon("longsword")).toBeDefined();
    expect(lookupWeapon("LONGSWORD")).toBeDefined();
  });

  it("returns undefined for unknown weapons", () => {
    expect(lookupWeapon("Unarmed Strike")).toBeUndefined();
    expect(lookupWeapon("Magic Wand")).toBeUndefined();
  });

  describe("simple melee weapons", () => {
    it("dagger has finesse, light, thrown", () => {
      const dagger = lookupWeapon("Dagger")!;
      expect(dagger.category).toBe("simple");
      expect(dagger.kind).toBe("melee");
      expect(dagger.damage).toEqual({ diceCount: 1, diceSides: 4, type: "piercing" });
      expect(dagger.properties).toContain("finesse");
      expect(dagger.properties).toContain("light");
      expect(dagger.properties).toContain("thrown");
      expect(dagger.range).toEqual([20, 60]);
      expect(dagger.mastery).toBe("nick");
    });

    it("quarterstaff has versatile with d8 two-handed damage", () => {
      const q = lookupWeapon("Quarterstaff")!;
      expect(q.properties).toContain("versatile");
      expect(q.versatileDiceSides).toBe(8);
      expect(q.mastery).toBe("topple");
    });
  });

  describe("martial melee weapons", () => {
    it("greatsword is heavy, two-handed with 2d6", () => {
      const gs = lookupWeapon("Greatsword")!;
      expect(gs.category).toBe("martial");
      expect(gs.damage).toEqual({ diceCount: 2, diceSides: 6, type: "slashing" });
      expect(gs.properties).toContain("heavy");
      expect(gs.properties).toContain("two-handed");
      expect(gs.mastery).toBe("graze");
    });

    it("rapier is finesse", () => {
      const r = lookupWeapon("Rapier")!;
      expect(r.properties).toContain("finesse");
      expect(r.properties).not.toContain("light");
    });

    it("whip has finesse and reach", () => {
      const w = lookupWeapon("Whip")!;
      expect(w.properties).toContain("finesse");
      expect(w.properties).toContain("reach");
    });
  });

  describe("ranged weapons", () => {
    it("longbow has ammunition, heavy, two-handed", () => {
      const lb = lookupWeapon("Longbow")!;
      expect(lb.kind).toBe("ranged");
      expect(lb.properties).toContain("ammunition");
      expect(lb.properties).toContain("heavy");
      expect(lb.properties).toContain("two-handed");
      expect(lb.range).toEqual([150, 600]);
      expect(lb.ammunitionType).toBe("Arrow");
    });

    it("hand crossbow has light and loading", () => {
      const hc = lookupWeapon("Hand Crossbow")!;
      expect(hc.properties).toContain("light");
      expect(hc.properties).toContain("loading");
      expect(hc.properties).toContain("ammunition");
    });
  });

  describe("hasWeaponProperty", () => {
    it("checks catalog entry directly", () => {
      const dagger = lookupWeapon("Dagger")!;
      expect(hasWeaponProperty(dagger, "finesse")).toBe(true);
      expect(hasWeaponProperty(dagger, "heavy")).toBe(false);
    });

    it("checks weapon by name", () => {
      expect(hasWeaponProperty("Longsword", "versatile")).toBe(true);
      expect(hasWeaponProperty("Longsword", "light")).toBe(false);
    });

    it("checks raw property arrays", () => {
      expect(hasWeaponProperty(["Finesse", "Light"], "finesse")).toBe(true);
      expect(hasWeaponProperty(["Finesse", "Light"], "heavy")).toBe(false);
    });

    it("handles embedded range in Thrown property", () => {
      expect(hasWeaponProperty(["Thrown (Range 20/60)"], "thrown")).toBe(true);
    });

    it("returns false for undefined", () => {
      expect(hasWeaponProperty(undefined, "finesse")).toBe(false);
    });
  });

  describe("getWeaponProperties", () => {
    it("resolves from catalog by name", () => {
      const props = getWeaponProperties("Dagger");
      expect(props).toContain("finesse");
      expect(props).toContain("light");
      expect(props).toContain("thrown");
    });

    it("passes through raw array", () => {
      const raw = ["Finesse", "Light"];
      expect(getWeaponProperties(raw)).toBe(raw);
    });

    it("returns empty for unknown weapon", () => {
      expect(getWeaponProperties("Unarmed Strike")).toEqual([]);
    });
  });

  describe("thrown range utilities", () => {
    it("parseThrownRange extracts normal/long range", () => {
      expect(parseThrownRange("Thrown (20/60)")).toEqual([20, 60]);
      expect(parseThrownRange("Thrown (Range 30/120)")).toEqual([30, 120]);
      expect(parseThrownRange("20/60")).toEqual([20, 60]);
    });

    it("parseThrownRange returns undefined for non-range strings", () => {
      expect(parseThrownRange("Finesse")).toBeUndefined();
    });

    it("getWeaponThrownRange resolves from catalog", () => {
      expect(getWeaponThrownRange("Javelin")).toEqual([30, 120]);
      expect(getWeaponThrownRange("Dagger")).toEqual([20, 60]);
    });

    it("getWeaponThrownRange falls back to property strings", () => {
      expect(getWeaponThrownRange("Custom Weapon", ["Thrown (25/75)"])).toEqual([25, 75]);
    });

    it("returns undefined for non-thrown weapons", () => {
      expect(getWeaponThrownRange("Longsword")).toBeUndefined();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Weapon Property Helpers
// ═══════════════════════════════════════════════════════════════════════════

describe("weapon property helpers", () => {
  it("hasProperty is case-insensitive", () => {
    expect(hasProperty(["Finesse"], "finesse")).toBe(true);
    expect(hasProperty(["finesse"], "Finesse")).toBe(true);
    expect(hasProperty(["FINESSE"], "finesse")).toBe(true);
  });

  it("hasProperty handles prefix matching for embedded data", () => {
    expect(hasProperty(["Thrown (Range 20/60)"], "thrown")).toBe(true);
    expect(hasProperty(["Ammunition (80/320; Arrow)"], "ammunition")).toBe(true);
  });

  it("named helpers work with character sheet property arrays", () => {
    const finesseLight = ["Finesse", "Light"];
    expect(isFinesse(finesseLight)).toBe(true);
    expect(isLight(finesseLight)).toBe(true);
    expect(isHeavy(finesseLight)).toBe(false);
    expect(isThrown(finesseLight)).toBe(false);
  });

  it("named helpers work for all property types", () => {
    expect(isLoading(["Loading"])).toBe(true);
    expect(isReach(["Reach"])).toBe(true);
    expect(isVersatile(["Versatile (1d10)"])).toBe(true);
    expect(isTwoHanded(["Two-Handed"])).toBe(true);
    expect(usesAmmunition(["Ammunition (80/320; Arrow)"])).toBe(true);
  });

  it("handles undefined gracefully", () => {
    expect(isFinesse(undefined)).toBe(false);
    expect(isLight(undefined)).toBe(false);
    expect(isHeavy(undefined)).toBe(false);
  });

  it("hasProperty resolves weapon name from catalog", () => {
    expect(hasProperty("Dagger", "finesse")).toBe(true);
    expect(hasProperty("Longsword", "finesse")).toBe(false);
    expect(hasProperty("Greatsword", "heavy")).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Armor Catalog
// ═══════════════════════════════════════════════════════════════════════════

describe("armor catalog", () => {
  it("contains all standard D&D 5e armor", () => {
    const all = getAllArmor();
    // 3 light + 5 medium + 4 heavy = 12
    expect(all.length).toBe(12);
  });

  it("looks up armor case-insensitively", () => {
    expect(lookupArmor("Plate")).toBeDefined();
    expect(lookupArmor("plate")).toBeDefined();
    expect(lookupArmor("PLATE")).toBeDefined();
  });

  describe("light armor", () => {
    it("studded leather has base 12 + full DEX", () => {
      const sl = lookupArmor("Studded Leather")!;
      expect(sl.category).toBe("light");
      expect(sl.acFormula).toEqual({ base: 12, addDexterityModifier: true });
      expect(sl.stealthDisadvantage).toBe(false);
    });
  });

  describe("medium armor", () => {
    it("half plate caps DEX at +2 with stealth disadvantage", () => {
      const hp = lookupArmor("Half Plate")!;
      expect(hp.category).toBe("medium");
      expect(hp.acFormula).toEqual({ base: 15, addDexterityModifier: true, dexterityModifierMax: 2 });
      expect(hp.stealthDisadvantage).toBe(true);
    });
  });

  describe("heavy armor", () => {
    it("plate has base 18, no DEX, STR 15 requirement", () => {
      const p = lookupArmor("Plate")!;
      expect(p.category).toBe("heavy");
      expect(p.acFormula).toEqual({ base: 18, addDexterityModifier: false });
      expect(p.strengthRequirement).toBe(15);
      expect(p.stealthDisadvantage).toBe(true);
    });

    it("ring mail has no strength requirement", () => {
      const rm = lookupArmor("Ring Mail")!;
      expect(rm.strengthRequirement).toBeUndefined();
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Magic Item Catalog
// ═══════════════════════════════════════════════════════════════════════════

describe("magic item catalog", () => {
  it("has built-in magic items", () => {
    expect(getAllMagicItems().length).toBeGreaterThan(0);
  });

  it("looks up by ID", () => {
    const ft = lookupMagicItemById("flame-tongue");
    expect(ft).toBeDefined();
    expect(ft!.name).toBe("Flame Tongue");
  });

  it("looks up by name (case-insensitive)", () => {
    expect(lookupMagicItem("Cloak of Protection")).toBeDefined();
    expect(lookupMagicItem("cloak of protection")).toBeDefined();
  });

  describe("Flame Tongue", () => {
    it("deals extra 2d6 fire on hit", () => {
      const ft = lookupMagicItemById("flame-tongue")!;
      expect(ft.attunement.required).toBe(true);
      expect(ft.onHitEffects).toHaveLength(1);
      expect(ft.onHitEffects![0].extraDamage).toEqual({
        diceCount: 2, diceSides: 6, type: "fire",
      });
      expect(ft.baseWeapon).toBe("Longsword");
    });
  });

  describe("Cloak of Protection", () => {
    it("grants +1 AC and +1 saving throws", () => {
      const cp = lookupMagicItemById("cloak-of-protection")!;
      expect(cp.modifiers).toEqual([
        { target: "ac", value: 1 },
        { target: "savingThrows", value: 1 },
      ]);
    });
  });

  describe("Staff of Fire", () => {
    it("has charges and grants spells", () => {
      const sf = lookupMagicItemById("staff-of-fire")!;
      expect(sf.charges!.max).toBe(10);
      expect(sf.charges!.rechargeTiming).toBe("dawn");
      expect(sf.charges!.destroyOnEmpty).toBe(true);
      expect(sf.grantedSpells).toHaveLength(3);
      expect(sf.grantedSpells![0]).toMatchObject({
        spellName: "Burning Hands",
        chargeCost: 1,
      });
    });
  });

  describe("Boots of Speed", () => {
    it("grants a bonus action ability", () => {
      const bs = lookupMagicItemById("boots-of-speed")!;
      expect(bs.grantedAbilities).toHaveLength(1);
      expect(bs.grantedAbilities![0].economy).toBe("bonus");
      expect(bs.grantedAbilities![0].usesPerRest).toEqual({ count: 1, restType: "long" });
    });
  });

  describe("bonus weapon factory", () => {
    it("creates +1 weapon with correct modifiers", () => {
      const plus1 = bonusWeapon(1, "Longsword");
      expect(plus1.name).toBe("+1 Longsword");
      expect(plus1.rarity).toBe("uncommon");
      expect(plus1.modifiers).toEqual([
        { target: "attackRolls", value: 1 },
        { target: "damageRolls", value: 1 },
      ]);
      expect(plus1.baseWeapon).toBe("Longsword");
    });

    it("creates +3 weapon at very-rare rarity", () => {
      const plus3 = bonusWeapon(3, "Greataxe");
      expect(plus3.rarity).toBe("very-rare");
      expect(plus3.modifiers![1].value).toBe(3);
    });
  });

  describe("bonus armor factory", () => {
    it("creates +1 armor with AC bonus", () => {
      const plus1 = bonusArmor(1, "Chain Mail");
      expect(plus1.name).toBe("+1 Chain Mail");
      expect(plus1.rarity).toBe("rare");
      expect(plus1.modifiers).toEqual([
        { target: "ac", value: 1 },
      ]);
    });
  });
});
