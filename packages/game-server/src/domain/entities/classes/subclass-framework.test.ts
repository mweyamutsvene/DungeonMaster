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
} from "./feature-keys.js";
import { ClassFeatureResolver } from "./class-feature-resolver.js";
import { ChampionSubclass } from "./fighter.js";
import { BerserkerSubclass } from "./barbarian.js";
import { ThiefSubclass } from "./rogue.js";
import { OpenHandSubclass } from "./monk.js";

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
