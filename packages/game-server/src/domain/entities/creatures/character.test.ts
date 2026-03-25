import { describe, expect, it } from "vitest";
import { AbilityScores } from "../core/ability-scores.js";
import { Character } from "./character.js";

describe("Character rest", () => {
  it("initializes resource pools from classId if omitted", () => {
    const c = new Character({
      id: "c0",
      name: "Wyll",
      maxHP: 10,
      currentHP: 10,
      armorClass: 12,
      speed: 30,
      abilityScores: new AbilityScores({
        strength: 10,
        dexterity: 10,
        constitution: 10,
        intelligence: 10,
        wisdom: 10,
        charisma: 16,
      }),
      level: 2,
      characterClass: "Warlock",
      classId: "warlock",
      experiencePoints: 0,
    });

    expect(c.getResourcePools()).toEqual([{ name: "pactMagic", current: 2, max: 2 }]);
  });

  it("refreshes warlock pact slots on short rest", () => {
    const c = new Character({
      id: "c1",
      name: "Wyll",
      maxHP: 10,
      currentHP: 10,
      armorClass: 12,
      speed: 30,
      abilityScores: new AbilityScores({
        strength: 10,
        dexterity: 10,
        constitution: 10,
        intelligence: 10,
        wisdom: 10,
        charisma: 16,
      }),
      level: 2,
      characterClass: "warlock",
      classId: "warlock",
      experiencePoints: 0,
      resourcePools: [{ name: "pactMagic", current: 0, max: 2 }],
    });

    c.takeRest("short");
    expect(c.getResourcePools()).toEqual([{ name: "pactMagic", current: 2, max: 2 }]);
  });

  it("refreshes barbarian rage only on long rest", () => {
    const c = new Character({
      id: "c2",
      name: "Karlach",
      maxHP: 12,
      currentHP: 12,
      armorClass: 13,
      speed: 30,
      abilityScores: new AbilityScores({
        strength: 16,
        dexterity: 14,
        constitution: 14,
        intelligence: 8,
        wisdom: 10,
        charisma: 10,
      }),
      level: 1,
      characterClass: "barbarian",
      classId: "barbarian",
      experiencePoints: 0,
      resourcePools: [{ name: "rage", current: 0, max: 2 }],
    });

    c.takeRest("short");
    expect(c.getResourcePools()[0]!.current).toBe(0);

    c.takeRest("long");
    expect(c.getResourcePools()[0]!.current).toBe(2);
  });

  it("refreshes bardic inspiration based on level and CHA mod", () => {
    const makeBard = (level: number) =>
      new Character({
        id: `b${level}`,
        name: "Lute",
        maxHP: 8,
        currentHP: 8,
        armorClass: 12,
        speed: 30,
        abilityScores: new AbilityScores({
          strength: 10,
          dexterity: 10,
          constitution: 10,
          intelligence: 10,
          wisdom: 10,
          charisma: 16, // mod +3
        }),
        level,
        characterClass: "bard",
        classId: "bard",
        experiencePoints: 0,
        resourcePools: [{ name: "bardicInspiration", current: 0, max: 3 }],
      });

    const at4 = makeBard(4);
    at4.takeRest("short");
    expect(at4.getResourcePools()[0]!.current).toBe(0);
    at4.takeRest("long");
    expect(at4.getResourcePools()[0]!.current).toBe(3);

    const at5 = makeBard(5);
    at5.takeRest("short");
    expect(at5.getResourcePools()[0]!.current).toBe(3);
  });
});

describe("Character level up", () => {
  it("recomputes max HP (average) and preserves damage", () => {
    // Barbarian d12, con +2.
    // L1 maxHP: 12+2 = 14
    // L2 gain (average): 7+2 = 9 => new maxHP 23
    const c = new Character({
      id: "lvl1",
      name: "Karlach",
      maxHP: 14,
      currentHP: 10,
      armorClass: 13,
      speed: 30,
      abilityScores: new AbilityScores({
        strength: 16,
        dexterity: 14,
        constitution: 14,
        intelligence: 8,
        wisdom: 10,
        charisma: 10,
      }),
      level: 1,
      characterClass: "barbarian",
      classId: "barbarian",
      experiencePoints: 0,
      resourcePools: [{ name: "rage", current: 2, max: 2 }],
    });

    c.levelUpWith({ hpMethod: "average" });

    expect(c.getLevel()).toBe(2);
    expect(c.getMaxHP()).toBe(23);
    // Preserve 4 damage: 23 - 4 = 19
    expect(c.getCurrentHP()).toBe(19);
  });

  it("adds newly gained pools and does not auto-refill existing pools", () => {
    const c = new Character({
      id: "f1",
      name: "Fighter",
      maxHP: 12,
      currentHP: 12,
      armorClass: 16,
      speed: 30,
      abilityScores: new AbilityScores({
        strength: 16,
        dexterity: 10,
        constitution: 14,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
      }),
      level: 1,
      characterClass: "fighter",
      classId: "fighter",
      experiencePoints: 0,
      resourcePools: [{ name: "secondWind", current: 0, max: 1 }],
    });

    c.levelUpWith({ hpMethod: "average" });

    expect(c.getLevel()).toBe(2);
    // secondWind remains spent; actionSurge is newly gained and starts full.
    expect(c.getResourcePools()).toEqual([
      { name: "actionSurge", current: 1, max: 1 },
      { name: "secondWind", current: 0, max: 1 },
    ]);
  });
});

describe("Character resources", () => {
  it("spends from a named resource pool", () => {
    const c = new Character({
      id: "r1",
      name: "Wyll",
      maxHP: 10,
      currentHP: 10,
      armorClass: 12,
      speed: 30,
      abilityScores: new AbilityScores({
        strength: 10,
        dexterity: 10,
        constitution: 10,
        intelligence: 10,
        wisdom: 10,
        charisma: 16,
      }),
      level: 2,
      characterClass: "warlock",
      classId: "warlock",
      experiencePoints: 0,
      resourcePools: [{ name: "pactMagic", current: 2, max: 2 }],
    });

    expect(c.canSpendResource("pactMagic", 2)).toBe(true);
    c.spendResource("pactMagic", 1);
    expect(c.getResourcePools()).toEqual([{ name: "pactMagic", current: 1, max: 2 }]);
    expect(c.canSpendResource("pactMagic", 2)).toBe(false);
  });

  it("throws on unknown or insufficient resources", () => {
    const c = new Character({
      id: "r2",
      name: "Monk",
      maxHP: 8,
      currentHP: 8,
      armorClass: 14,
      speed: 30,
      abilityScores: new AbilityScores({
        strength: 10,
        dexterity: 16,
        constitution: 12,
        intelligence: 10,
        wisdom: 14,
        charisma: 8,
      }),
      level: 5,
      characterClass: "monk",
      classId: "monk",
      experiencePoints: 0,
      resourcePools: [{ name: "ki", current: 1, max: 5 }],
    });

    expect(() => c.spendResource("doesNotExist", 1)).toThrow(/Unknown resource pool/i);
    expect(() => c.spendResource("ki", 2)).toThrow(/Insufficient ki/i);
  });
});

describe("Character armor class (equipment)", () => {
  it("computes AC from equipped medium armor + shield", () => {
    const c = new Character({
      id: "ac1",
      name: "Fighter",
      maxHP: 10,
      currentHP: 10,
      // Should be ignored when equipment is provided.
      armorClass: 0,
      speed: 30,
      abilityScores: new AbilityScores({
        strength: 10,
        dexterity: 16, // mod +3, but medium armor caps at +2
        constitution: 10,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
      }),
      level: 1,
      characterClass: "fighter",
      classId: "fighter",
      experiencePoints: 0,
      equipment: {
        armor: {
          name: "Chain Shirt",
          category: "medium",
          armorClass: { base: 13, addDexterityModifier: true, dexterityModifierMax: 2 },
        },
        shield: {
          name: "Shield",
          armorClassBonus: 2,
        },
      },
    });

    // 13 + min(DEX+3,2)=2 + 2 = 17
    expect(c.getAC()).toBe(17);
  });

  it("applies Defense feat +1 AC only while armored", () => {
    const armored = new Character({
      id: "ac2",
      name: "Defender",
      maxHP: 10,
      currentHP: 10,
      armorClass: 10,
      speed: 30,
      abilityScores: new AbilityScores({
        strength: 10,
        dexterity: 14, // mod +2
        constitution: 10,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
      }),
      level: 1,
      characterClass: "fighter",
      classId: "fighter",
      experiencePoints: 0,
      featIds: ["feat_defense"],
      equipment: {
        armor: {
          name: "Leather Armor",
          category: "light",
          armorClass: { base: 11, addDexterityModifier: true },
        },
      },
    });

    // 11 + DEX(2) + Defense(1) = 14
    expect(armored.getAC()).toBe(14);

    const shieldOnly = new Character({
      id: "ac3",
      name: "ShieldOnly",
      maxHP: 10,
      currentHP: 10,
      armorClass: 10,
      speed: 30,
      abilityScores: new AbilityScores({
        strength: 10,
        dexterity: 14, // mod +2
        constitution: 10,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
      }),
      level: 1,
      characterClass: "fighter",
      classId: "fighter",
      experiencePoints: 0,
      featIds: ["feat_defense"],
      equipment: {
        shield: { name: "Shield", armorClassBonus: 2 },
      },
    });

    // Unarmored base 10 + DEX(2) + shield(2) = 14; no Defense bonus.
    expect(shieldOnly.getAC()).toBe(14);
  });

  it("does not apply shield AC bonus without shield training", () => {
    const c = new Character({
      id: "ac4",
      name: "Untrained",
      maxHP: 10,
      currentHP: 10,
      armorClass: 10,
      speed: 30,
      abilityScores: new AbilityScores({
        strength: 10,
        dexterity: 14, // mod +2
        constitution: 10,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
      }),
      level: 1,
      characterClass: "wizard",
      classId: "wizard",
      experiencePoints: 0,
      armorTraining: { shield: false },
      equipment: {
        shield: { name: "Shield", armorClassBonus: 2 },
      },
    });

    // Base 10 + DEX(2); shield bonus suppressed.
    expect(c.getAC()).toBe(12);
  });
});

describe("Character Unarmored Defense", () => {
  it("Monk with no armor: AC = 10 + DEX + WIS", () => {
    const monk = new Character({
      id: "ud-monk",
      name: "Monk",
      maxHP: 8,
      currentHP: 8,
      armorClass: 10, // should be overridden
      speed: 30,
      abilityScores: new AbilityScores({
        strength: 10,
        dexterity: 16, // +3
        constitution: 12,
        intelligence: 10,
        wisdom: 16, // +3
        charisma: 8,
      }),
      level: 1,
      characterClass: "Monk",
      classId: "monk",
      experiencePoints: 0,
    });

    // 10 + DEX(3) + WIS(3) = 16
    expect(monk.getAC()).toBe(16);
  });

  it("Barbarian with no armor: AC = 10 + DEX + CON", () => {
    const barb = new Character({
      id: "ud-barb",
      name: "Barb",
      maxHP: 12,
      currentHP: 12,
      armorClass: 10,
      speed: 30,
      abilityScores: new AbilityScores({
        strength: 16,
        dexterity: 14, // +2
        constitution: 16, // +3
        intelligence: 8,
        wisdom: 10,
        charisma: 10,
      }),
      level: 1,
      characterClass: "Barbarian",
      classId: "barbarian",
      experiencePoints: 0,
    });

    // 10 + DEX(2) + CON(3) = 15
    expect(barb.getAC()).toBe(15);
  });

  it("Monk wearing armor uses normal AC, not unarmored", () => {
    const monk = new Character({
      id: "ud-monk-armor",
      name: "ArmoredMonk",
      maxHP: 8,
      currentHP: 8,
      armorClass: 10,
      speed: 30,
      abilityScores: new AbilityScores({
        strength: 10,
        dexterity: 16, // +3
        constitution: 12,
        intelligence: 10,
        wisdom: 16, // +3
        charisma: 8,
      }),
      level: 1,
      characterClass: "Monk",
      classId: "monk",
      experiencePoints: 0,
      equipment: {
        armor: {
          name: "Leather Armor",
          category: "light",
          armorClass: { base: 11, addDexterityModifier: true },
        },
      },
    });

    // Leather + DEX(3) = 14, NOT unarmored (16)
    expect(monk.getAC()).toBe(14);
  });

  it("Monk unarmored + shield still adds shield bonus", () => {
    const monk = new Character({
      id: "ud-monk-shield",
      name: "ShieldMonk",
      maxHP: 8,
      currentHP: 8,
      armorClass: 10,
      speed: 30,
      abilityScores: new AbilityScores({
        strength: 10,
        dexterity: 16, // +3
        constitution: 12,
        intelligence: 10,
        wisdom: 14, // +2
        charisma: 8,
      }),
      level: 1,
      characterClass: "Monk",
      classId: "monk",
      experiencePoints: 0,
      equipment: {
        shield: { name: "Shield", armorClassBonus: 2 },
      },
    });

    // 10 + DEX(3) + WIS(2) + shield(2) = 17
    expect(monk.getAC()).toBe(17);
  });

  it("Fighter (non-unarmored-defense class) uses normal AC formula when unarmored", () => {
    const fighter = new Character({
      id: "ud-fighter",
      name: "Fighter",
      maxHP: 10,
      currentHP: 10,
      armorClass: 12, // fallback when no equipment
      speed: 30,
      abilityScores: new AbilityScores({
        strength: 16,
        dexterity: 14,
        constitution: 14,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
      }),
      level: 1,
      characterClass: "Fighter",
      classId: "fighter",
      experiencePoints: 0,
    });

    // No equipment → falls back to armorClass field = 12
    expect(fighter.getAC()).toBe(12);
  });
});

describe("Character species traits", () => {
  it("stores darkvision and species damage resistances", () => {
    const c = new Character({
      id: "sp1",
      name: "Dwarf",
      maxHP: 10,
      currentHP: 10,
      armorClass: 12,
      speed: 25,
      abilityScores: new AbilityScores({
        strength: 14,
        dexterity: 10,
        constitution: 16,
        intelligence: 10,
        wisdom: 12,
        charisma: 8,
      }),
      level: 1,
      characterClass: "Fighter",
      classId: "fighter",
      experiencePoints: 0,
      darkvisionRange: 60,
      speciesDamageResistances: ["poison"],
    });

    expect(c.getDarkvisionRange()).toBe(60);
    expect(c.getSpeciesDamageResistances()).toEqual(["poison"]);
  });

  it("defaults darkvision to 0 and resistances to empty", () => {
    const c = new Character({
      id: "sp2",
      name: "Human",
      maxHP: 10,
      currentHP: 10,
      armorClass: 12,
      speed: 30,
      abilityScores: new AbilityScores({
        strength: 10,
        dexterity: 10,
        constitution: 10,
        intelligence: 10,
        wisdom: 10,
        charisma: 10,
      }),
      level: 1,
      characterClass: "Fighter",
      classId: "fighter",
      experiencePoints: 0,
    });

    expect(c.getDarkvisionRange()).toBe(0);
    expect(c.getSpeciesDamageResistances()).toEqual([]);
  });
});
