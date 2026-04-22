import { describe, expect, it } from "vitest";
import { classHasFeature, getSubclassDefinition, getCriticalHitThreshold, getAllCombatTextProfiles } from "./registry.js";
import {
  IMPROVED_CRITICAL,
  SUPERIOR_CRITICAL,
  FRENZY,
  FAST_HANDS,
  OPEN_HAND_TECHNIQUE,
  EXTRA_ATTACK,
  ACTION_SURGE,
  RAGE,
  DISCIPLE_OF_LIFE,
  PRESERVE_LIFE,
  LIFE_DOMAIN_SPELLS,
  SACRED_WEAPON,
  OATH_OF_DEVOTION_SPELLS,
  DARK_ONES_BLESSING,
  FIEND_EXPANDED_SPELLS,
  SCULPT_SPELLS,
  EVOCATION_SAVANT,
  CUTTING_WORDS,
  ADDITIONAL_MAGICAL_SECRETS,
  BONUS_PROFICIENCIES,
  CIRCLE_SPELLS,
  LANDS_AID,
  DRACONIC_RESILIENCE,
  DRACONIC_ANCESTRY,
  ELEMENTAL_AFFINITY,
  INNATE_SORCERY,
  TURN_UNDEAD,
} from "./feature-keys.js";
import { ClassFeatureResolver } from "./class-feature-resolver.js";
import { ChampionSubclass } from "./fighter.js";
import { BerserkerSubclass } from "./barbarian.js";
import { ThiefSubclass } from "./rogue.js";
import { OpenHandSubclass } from "./monk.js";
import { LifeDomainSubclass } from "./cleric.js";
import { OathOfDevotionSubclass } from "./paladin.js";
import { TheFiendSubclass } from "./warlock.js";
import { SchoolOfEvocationSubclass } from "./wizard.js";
import { CollegeOfLoreSubclass } from "./bard.js";
import { CircleOfTheLandGrasslandSubclass } from "./druid.js";
import { DraconicSorceryRedSubclass } from "./sorcerer.js";

// ── Subclass Framework ──────────────────────────────────────

describe("Subclass framework", () => {
  describe("getSubclassDefinition", () => {
    it("finds Champion subclass for fighter", () => {
      const sub = getSubclassDefinition("fighter", "champion");
      expect(sub).toBeDefined();
      expect(sub!.id).toBe("champion");
      expect(sub!.name).toBe("Champion");
      expect(sub!.classId).toBe("fighter");
    });

    it("finds Berserker subclass for barbarian", () => {
      const sub = getSubclassDefinition("barbarian", "berserker");
      expect(sub).toBeDefined();
      expect(sub!.id).toBe("berserker");
      expect(sub!.name).toBe("Path of the Berserker");
    });

    it("finds Thief subclass for rogue", () => {
      const sub = getSubclassDefinition("rogue", "thief");
      expect(sub).toBeDefined();
      expect(sub!.id).toBe("thief");
      expect(sub!.name).toBe("Thief");
    });

    it("finds Open Hand subclass for monk", () => {
      const sub = getSubclassDefinition("monk", "open-hand");
      expect(sub).toBeDefined();
      expect(sub!.id).toBe("open-hand");
      expect(sub!.name).toBe("Way of the Open Hand");
    });

    it("normalizes subclass ID (case, spaces)", () => {
      expect(getSubclassDefinition("fighter", "Champion")).toBeDefined();
      expect(getSubclassDefinition("monk", "Open Hand")).toBeDefined();
      expect(getSubclassDefinition("monk", "openhand")).toBeDefined();
    });

    it("returns undefined for unknown subclass", () => {
      expect(getSubclassDefinition("fighter", "battlemaster")).toBeUndefined();
    });

    it("returns undefined for invalid class", () => {
      expect(getSubclassDefinition("invalid", "champion")).toBeUndefined();
    });
  });

  describe("classHasFeature with subclass", () => {
    it("finds class features without subclassId (backwards compatible)", () => {
      expect(classHasFeature("fighter", ACTION_SURGE, 2)).toBe(true);
      expect(classHasFeature("barbarian", RAGE, 1)).toBe(true);
    });

    it("finds subclass features when subclassId is provided", () => {
      expect(classHasFeature("fighter", IMPROVED_CRITICAL, 3, "champion")).toBe(true);
      expect(classHasFeature("barbarian", FRENZY, 3, "berserker")).toBe(true);
      expect(classHasFeature("rogue", FAST_HANDS, 3, "thief")).toBe(true);
    });

    it("does NOT find subclass features without subclassId", () => {
      expect(classHasFeature("fighter", IMPROVED_CRITICAL, 3)).toBe(false);
      expect(classHasFeature("barbarian", FRENZY, 3)).toBe(false);
      expect(classHasFeature("rogue", FAST_HANDS, 3)).toBe(false);
    });

    it("respects minimum level for subclass features", () => {
      expect(classHasFeature("fighter", IMPROVED_CRITICAL, 2, "champion")).toBe(false);
      expect(classHasFeature("fighter", IMPROVED_CRITICAL, 3, "champion")).toBe(true);
      expect(classHasFeature("fighter", SUPERIOR_CRITICAL, 14, "champion")).toBe(false);
      expect(classHasFeature("fighter", SUPERIOR_CRITICAL, 15, "champion")).toBe(true);
    });

    it("does NOT find subclass features for wrong subclass", () => {
      expect(classHasFeature("fighter", IMPROVED_CRITICAL, 3, "battlemaster")).toBe(false);
    });

    it("still finds class features even when subclassId is provided", () => {
      expect(classHasFeature("fighter", EXTRA_ATTACK, 5, "champion")).toBe(true);
      expect(classHasFeature("fighter", ACTION_SURGE, 2, "champion")).toBe(true);
    });
  });
});

// ── Champion Fighter ────────────────────────────────────────

describe("Champion Fighter subclass", () => {
  it("has correct features", () => {
    expect(ChampionSubclass.features["improved-critical"]).toBe(3);
    expect(ChampionSubclass.features["remarkable-athlete"]).toBe(3);
    expect(ChampionSubclass.features["additional-fighting-style"]).toBe(7);
    expect(ChampionSubclass.features["superior-critical"]).toBe(15);
  });

  describe("getCriticalHitThreshold", () => {
    it("returns 20 for non-champion", () => {
      expect(getCriticalHitThreshold("fighter", 5)).toBe(20);
      expect(getCriticalHitThreshold("fighter", 5, "battlemaster")).toBe(20);
    });

    it("returns 19 for Champion level 3+ (Improved Critical)", () => {
      expect(getCriticalHitThreshold("fighter", 3, "champion")).toBe(19);
      expect(getCriticalHitThreshold("fighter", 10, "champion")).toBe(19);
      expect(getCriticalHitThreshold("fighter", 14, "champion")).toBe(19);
    });

    it("returns 18 for Champion level 15+ (Superior Critical)", () => {
      expect(getCriticalHitThreshold("fighter", 15, "champion")).toBe(18);
      expect(getCriticalHitThreshold("fighter", 20, "champion")).toBe(18);
    });

    it("returns 20 for Champion below level 3", () => {
      expect(getCriticalHitThreshold("fighter", 2, "champion")).toBe(20);
    });

    it("returns 20 for non-fighter classes", () => {
      expect(getCriticalHitThreshold("barbarian", 5, "berserker")).toBe(20);
      expect(getCriticalHitThreshold("rogue", 5, "thief")).toBe(20);
    });
  });
});

// ── Berserker Barbarian ─────────────────────────────────────

describe("Berserker Barbarian subclass", () => {
  it("has correct features", () => {
    expect(BerserkerSubclass.features["frenzy"]).toBe(3);
    expect(BerserkerSubclass.features["mindless-rage"]).toBe(6);
    expect(BerserkerSubclass.features["intimidating-presence"]).toBe(10);
  });

  it("frenzy available at level 3 with berserker subclass", () => {
    expect(classHasFeature("barbarian", "frenzy", 3, "berserker")).toBe(true);
    expect(classHasFeature("barbarian", "frenzy", 2, "berserker")).toBe(false);
  });

  it("mindless rage available at level 6", () => {
    expect(classHasFeature("barbarian", "mindless-rage", 6, "berserker")).toBe(true);
    expect(classHasFeature("barbarian", "mindless-rage", 5, "berserker")).toBe(false);
  });
});

// ── Thief Rogue ─────────────────────────────────────────────

describe("Thief Rogue subclass", () => {
  it("has correct features", () => {
    expect(ThiefSubclass.features["fast-hands"]).toBe(3);
    expect(ThiefSubclass.features["second-story-work"]).toBe(3);
    expect(ThiefSubclass.features["supreme-sneak"]).toBe(9);
  });

  it("fast hands available at level 3 with thief subclass", () => {
    expect(classHasFeature("rogue", "fast-hands", 3, "thief")).toBe(true);
    expect(classHasFeature("rogue", "fast-hands", 2, "thief")).toBe(false);
  });

  it("supreme sneak available at level 9", () => {
    expect(classHasFeature("rogue", "supreme-sneak", 9, "thief")).toBe(true);
    expect(classHasFeature("rogue", "supreme-sneak", 8, "thief")).toBe(false);
  });
});

// ── Open Hand Monk Migration ────────────────────────────────

describe("Open Hand Monk subclass migration", () => {
  it("open-hand-technique is NOT in class features (moved to subclass)", () => {
    expect(classHasFeature("monk", OPEN_HAND_TECHNIQUE, 3)).toBe(false);
    expect(classHasFeature("monk", OPEN_HAND_TECHNIQUE, 20)).toBe(false);
  });

  it("open-hand-technique IS in Open Hand subclass features", () => {
    expect(classHasFeature("monk", OPEN_HAND_TECHNIQUE, 3, "open-hand")).toBe(true);
    expect(classHasFeature("monk", OPEN_HAND_TECHNIQUE, 2, "open-hand")).toBe(false);
  });

  it("hasOpenHandTechnique uses subclass framework", () => {
    expect(ClassFeatureResolver.hasOpenHandTechnique(null, "monk", "Open Hand", 3)).toBe(true);
    expect(ClassFeatureResolver.hasOpenHandTechnique(null, "monk", "Open Hand", 2)).toBe(false);
    expect(ClassFeatureResolver.hasOpenHandTechnique(null, "monk", null, 3)).toBe(false);
    expect(ClassFeatureResolver.hasOpenHandTechnique(null, "monk", "Shadow", 3)).toBe(false);
  });

  it("hasOpenHandTechnique normalizes subclass names", () => {
    expect(ClassFeatureResolver.hasOpenHandTechnique(null, "monk", "openhand", 3)).toBe(true);
    expect(ClassFeatureResolver.hasOpenHandTechnique(null, "monk", "open-hand", 3)).toBe(true);
    expect(ClassFeatureResolver.hasOpenHandTechnique(null, "monk", "Open Hand", 3)).toBe(true);
  });

  it("Open Hand subclass definition is properly structured", () => {
    expect(OpenHandSubclass.id).toBe("open-hand");
    expect(OpenHandSubclass.classId).toBe("monk");
    expect(OpenHandSubclass.features["open-hand-technique"]).toBe(3);
  });
});

// ── Combat text profiles include subclass profiles ──────────

describe("getAllCombatTextProfiles", () => {
  it("returns profiles for all registered classes", () => {
    const profiles = getAllCombatTextProfiles();
    const classIds = profiles.map((p) => p.classId);
    expect(classIds).toContain("monk");
    expect(classIds).toContain("fighter");
    expect(classIds).toContain("barbarian");
    expect(classIds).toContain("rogue");
  });
});

// ── Phase 1 subclass shells (7 new) ─────────────────────────

describe("Life Domain Cleric subclass", () => {
  it("is exported and well-formed", () => {
    expect(LifeDomainSubclass.id).toBe("life-domain");
    expect(LifeDomainSubclass.classId).toBe("cleric");
  });

  it("is resolvable via getSubclassDefinition", () => {
    expect(getSubclassDefinition("cleric", "life-domain")).toBeDefined();
    expect(getSubclassDefinition("cleric", "Life Domain")).toBeDefined();
  });

  it("grants Life Domain features at level 3", () => {
    expect(classHasFeature("cleric", DISCIPLE_OF_LIFE, 3, "life-domain")).toBe(true);
    expect(classHasFeature("cleric", DISCIPLE_OF_LIFE, 2, "life-domain")).toBe(false);
    expect(classHasFeature("cleric", PRESERVE_LIFE, 3, "life-domain")).toBe(true);
    expect(classHasFeature("cleric", LIFE_DOMAIN_SPELLS, 3, "life-domain")).toBe(true);
  });

  it("does not grant Life features without subclassId", () => {
    expect(classHasFeature("cleric", DISCIPLE_OF_LIFE, 20)).toBe(false);
  });

  it("still exposes base Cleric features when subclass set", () => {
    expect(classHasFeature("cleric", TURN_UNDEAD, 2, "life-domain")).toBe(true);
  });
});

describe("Oath of Devotion Paladin subclass", () => {
  it("is exported and well-formed", () => {
    expect(OathOfDevotionSubclass.id).toBe("oath-of-devotion");
    expect(OathOfDevotionSubclass.classId).toBe("paladin");
  });

  it("is resolvable via getSubclassDefinition", () => {
    expect(getSubclassDefinition("paladin", "oath-of-devotion")).toBeDefined();
  });

  it("grants Devotion features at level 3", () => {
    expect(classHasFeature("paladin", SACRED_WEAPON, 3, "oath-of-devotion")).toBe(true);
    expect(classHasFeature("paladin", SACRED_WEAPON, 2, "oath-of-devotion")).toBe(false);
    expect(classHasFeature("paladin", OATH_OF_DEVOTION_SPELLS, 3, "oath-of-devotion")).toBe(true);
  });
});

describe("The Fiend Warlock subclass", () => {
  it("is exported and well-formed", () => {
    expect(TheFiendSubclass.id).toBe("the-fiend");
    expect(TheFiendSubclass.classId).toBe("warlock");
  });

  it("is resolvable via getSubclassDefinition", () => {
    expect(getSubclassDefinition("warlock", "the-fiend")).toBeDefined();
    expect(getSubclassDefinition("warlock", "The Fiend")).toBeDefined();
  });

  it("grants Fiend features at level 3", () => {
    expect(classHasFeature("warlock", DARK_ONES_BLESSING, 3, "the-fiend")).toBe(true);
    expect(classHasFeature("warlock", DARK_ONES_BLESSING, 2, "the-fiend")).toBe(false);
    expect(classHasFeature("warlock", FIEND_EXPANDED_SPELLS, 3, "the-fiend")).toBe(true);
  });
});

describe("School of Evocation Wizard subclass", () => {
  it("is exported and well-formed", () => {
    expect(SchoolOfEvocationSubclass.id).toBe("school-of-evocation");
    expect(SchoolOfEvocationSubclass.classId).toBe("wizard");
  });

  it("is resolvable via getSubclassDefinition", () => {
    expect(getSubclassDefinition("wizard", "school-of-evocation")).toBeDefined();
  });

  it("grants Evocation features at level 3", () => {
    expect(classHasFeature("wizard", SCULPT_SPELLS, 3, "school-of-evocation")).toBe(true);
    expect(classHasFeature("wizard", SCULPT_SPELLS, 2, "school-of-evocation")).toBe(false);
    expect(classHasFeature("wizard", EVOCATION_SAVANT, 3, "school-of-evocation")).toBe(true);
  });
});

describe("College of Lore Bard subclass", () => {
  it("is exported and well-formed", () => {
    expect(CollegeOfLoreSubclass.id).toBe("college-of-lore");
    expect(CollegeOfLoreSubclass.classId).toBe("bard");
  });

  it("is resolvable via getSubclassDefinition", () => {
    expect(getSubclassDefinition("bard", "college-of-lore")).toBeDefined();
  });

  it("grants Lore features at the correct levels", () => {
    expect(classHasFeature("bard", CUTTING_WORDS, 3, "college-of-lore")).toBe(true);
    expect(classHasFeature("bard", CUTTING_WORDS, 2, "college-of-lore")).toBe(false);
    expect(classHasFeature("bard", BONUS_PROFICIENCIES, 3, "college-of-lore")).toBe(true);
    expect(classHasFeature("bard", ADDITIONAL_MAGICAL_SECRETS, 6, "college-of-lore")).toBe(true);
    expect(classHasFeature("bard", ADDITIONAL_MAGICAL_SECRETS, 5, "college-of-lore")).toBe(false);
  });
});

describe("Circle of the Land (Grassland) Druid subclass", () => {
  it("is exported and well-formed", () => {
    expect(CircleOfTheLandGrasslandSubclass.id).toBe("circle-of-the-land-grassland");
    expect(CircleOfTheLandGrasslandSubclass.classId).toBe("druid");
  });

  it("is resolvable via getSubclassDefinition", () => {
    expect(getSubclassDefinition("druid", "circle-of-the-land-grassland")).toBeDefined();
  });

  it("grants Land features at level 3", () => {
    expect(classHasFeature("druid", CIRCLE_SPELLS, 3, "circle-of-the-land-grassland")).toBe(true);
    expect(classHasFeature("druid", CIRCLE_SPELLS, 2, "circle-of-the-land-grassland")).toBe(false);
    expect(classHasFeature("druid", LANDS_AID, 3, "circle-of-the-land-grassland")).toBe(true);
  });
});

describe("Draconic Sorcery (Red) Sorcerer subclass", () => {
  it("is exported and well-formed", () => {
    expect(DraconicSorceryRedSubclass.id).toBe("draconic-sorcery-red");
    expect(DraconicSorceryRedSubclass.classId).toBe("sorcerer");
  });

  it("is resolvable via getSubclassDefinition", () => {
    expect(getSubclassDefinition("sorcerer", "draconic-sorcery-red")).toBeDefined();
  });

  it("grants Draconic features at level 1 (Sorcerous Origin in 2024)", () => {
    expect(classHasFeature("sorcerer", DRACONIC_RESILIENCE, 1, "draconic-sorcery-red")).toBe(true);
    expect(classHasFeature("sorcerer", DRACONIC_ANCESTRY, 1, "draconic-sorcery-red")).toBe(true);
  });

  it("grants Elemental Affinity at level 5", () => {
    expect(classHasFeature("sorcerer", ELEMENTAL_AFFINITY, 5, "draconic-sorcery-red")).toBe(true);
    expect(classHasFeature("sorcerer", ELEMENTAL_AFFINITY, 4, "draconic-sorcery-red")).toBe(false);
  });

  it("base Sorcerer class now grants Innate Sorcery at level 1", () => {
    expect(classHasFeature("sorcerer", INNATE_SORCERY, 1)).toBe(true);
  });
});
