import { describe, it, expect } from "vitest";
import { isEligibleWarCasterSpell, hasSpellSlotForOA, findBestWarCasterSpell } from "./war-caster-oa.js";
import type { PreparedSpellDefinition } from "../entities/spells/prepared-spell-definition.js";

describe("war-caster-oa", () => {
  describe("isEligibleWarCasterSpell", () => {
    it("allows a basic attack cantrip (Fire Bolt)", () => {
      const spell: PreparedSpellDefinition = {
        name: "Fire Bolt",
        level: 0,
        attackType: "ranged_spell",
        damage: { diceCount: 1, diceSides: 10 },
        damageType: "fire",
      };
      expect(isEligibleWarCasterSpell(spell)).toBe(true);
    });

    it("allows a melee spell attack (Inflict Wounds)", () => {
      const spell: PreparedSpellDefinition = {
        name: "Inflict Wounds",
        level: 1,
        attackType: "melee_spell",
        damage: { diceCount: 3, diceSides: 10 },
        damageType: "necrotic",
      };
      expect(isEligibleWarCasterSpell(spell)).toBe(true);
    });

    it("allows a single-target save spell (Hold Person)", () => {
      const spell: PreparedSpellDefinition = {
        name: "Hold Person",
        level: 2,
        saveAbility: "wisdom",
        concentration: true,
        conditions: { onFailure: ["Paralyzed"] },
      };
      expect(isEligibleWarCasterSpell(spell)).toBe(true);
    });

    it("rejects a bonus action spell", () => {
      const spell: PreparedSpellDefinition = {
        name: "Healing Word",
        level: 1,
        isBonusAction: true,
        healing: { diceCount: 1, diceSides: 4, modifier: 3 },
      };
      expect(isEligibleWarCasterSpell(spell)).toBe(false);
    });

    it("rejects a spell with area of effect", () => {
      const spell: PreparedSpellDefinition = {
        name: "Burning Hands",
        level: 1,
        saveAbility: "dexterity",
        damage: { diceCount: 3, diceSides: 6 },
        damageType: "fire",
        area: { type: "cone", size: 15 },
      };
      expect(isEligibleWarCasterSpell(spell)).toBe(false);
    });

    it("rejects a zone spell", () => {
      const spell: PreparedSpellDefinition = {
        name: "Spirit Guardians",
        level: 3,
        concentration: true,
        zone: {
          type: "sphere",
          radiusFeet: 15,
          attachToSelf: true,
          effects: [],
        },
      };
      expect(isEligibleWarCasterSpell(spell)).toBe(false);
    });
  });

  describe("hasSpellSlotForOA", () => {
    it("returns true for cantrips regardless of slots", () => {
      expect(hasSpellSlotForOA({}, 0)).toBe(true);
    });

    it("returns true when a matching slot level is available", () => {
      const resources = {
        resourcePools: [
          { name: "Spell Slot (Level 1)", current: 2, max: 3 },
        ],
      };
      expect(hasSpellSlotForOA(resources, 1)).toBe(true);
    });

    it("returns true when a higher slot level is available", () => {
      const resources = {
        resourcePools: [
          { name: "Spell Slot (Level 1)", current: 0, max: 3 },
          { name: "Spell Slot (Level 2)", current: 1, max: 2 },
        ],
      };
      expect(hasSpellSlotForOA(resources, 1)).toBe(true);
    });

    it("returns false when no slots are available", () => {
      const resources = {
        resourcePools: [
          { name: "Spell Slot (Level 1)", current: 0, max: 3 },
        ],
      };
      expect(hasSpellSlotForOA(resources, 1)).toBe(false);
    });

    it("returns false when no resource pools exist", () => {
      expect(hasSpellSlotForOA({}, 1)).toBe(false);
    });
  });

  describe("findBestWarCasterSpell", () => {
    const fireBolt: PreparedSpellDefinition = {
      name: "Fire Bolt",
      level: 0,
      attackType: "ranged_spell",
      damage: { diceCount: 1, diceSides: 10 },
      damageType: "fire",
    };

    const inflictWounds: PreparedSpellDefinition = {
      name: "Inflict Wounds",
      level: 1,
      attackType: "melee_spell",
      damage: { diceCount: 3, diceSides: 10 },
      damageType: "necrotic",
    };

    const healingWord: PreparedSpellDefinition = {
      name: "Healing Word",
      level: 1,
      isBonusAction: true,
      healing: { diceCount: 1, diceSides: 4, modifier: 3 },
    };

    const burningHands: PreparedSpellDefinition = {
      name: "Burning Hands",
      level: 1,
      saveAbility: "dexterity",
      damage: { diceCount: 3, diceSides: 6 },
      damageType: "fire",
      area: { type: "cone", size: 15 },
    };

    it("prefers cantrips over leveled spells", () => {
      const resources = {
        resourcePools: [
          { name: "Spell Slot (Level 1)", current: 2, max: 3 },
        ],
      };
      const result = findBestWarCasterSpell([inflictWounds, fireBolt, healingWord], resources);
      expect(result).not.toBeNull();
      expect(result!.spell.name).toBe("Fire Bolt");
    });

    it("filters out ineligible spells", () => {
      const resources = {};
      const result = findBestWarCasterSpell([healingWord, burningHands], resources);
      expect(result).toBeNull();
    });

    it("falls back to leveled attack spells when no cantrips", () => {
      const resources = {
        resourcePools: [
          { name: "Spell Slot (Level 1)", current: 1, max: 3 },
        ],
      };
      const result = findBestWarCasterSpell([inflictWounds], resources);
      expect(result).not.toBeNull();
      expect(result!.spell.name).toBe("Inflict Wounds");
    });

    it("returns null when no slots for leveled spells", () => {
      const resources = {
        resourcePools: [
          { name: "Spell Slot (Level 1)", current: 0, max: 3 },
        ],
      };
      const result = findBestWarCasterSpell([inflictWounds], resources);
      expect(result).toBeNull();
    });

    it("returns null for empty spell list", () => {
      const result = findBestWarCasterSpell([], {});
      expect(result).toBeNull();
    });
  });
});
