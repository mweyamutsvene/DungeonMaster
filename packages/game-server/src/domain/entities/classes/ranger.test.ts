import { describe, expect, it } from "vitest";
import { classHasFeature } from "./registry.js";
import { WEAPON_MASTERY } from "./feature-keys.js";
import { Ranger, RANGER_COMBAT_TEXT_PROFILE } from "./ranger.js";
import { tryMatchClassAction } from "./combat-text-profile.js";

describe("Ranger features", () => {
  it("gates major features by level (up to 5) via features map", () => {
    expect(classHasFeature("ranger", "spellcasting", 1)).toBe(false);
    expect(classHasFeature("ranger", "extra-attack", 1)).toBe(false);

    expect(classHasFeature("ranger", "spellcasting", 2)).toBe(true);
    expect(classHasFeature("ranger", "extra-attack", 2)).toBe(false);

    expect(classHasFeature("ranger", "extra-attack", 4)).toBe(false);
    expect(classHasFeature("ranger", "extra-attack", 5)).toBe(true);
  });

  it("has weapon-mastery at level 1", () => {
    expect(classHasFeature("ranger", WEAPON_MASTERY, 1)).toBe(true);
  });

  it("has favored-enemy at level 1", () => {
    expect(classHasFeature("ranger", "favored-enemy", 1)).toBe(true);
  });
});

describe("Ranger capabilitiesForLevel", () => {
  it("returns Favored Enemy and Weapon Mastery at level 1", () => {
    const caps = Ranger.capabilitiesForLevel!(1);
    const names = caps.map(c => c.name);
    expect(names).toContain("Favored Enemy");
    expect(names).toContain("Weapon Mastery");
    expect(names).not.toContain("Fighting Style");
    expect(names).not.toContain("Spellcasting");
    expect(names).not.toContain("Extra Attack");
  });

  it("includes Fighting Style and Spellcasting at level 2", () => {
    const caps = Ranger.capabilitiesForLevel!(2);
    const names = caps.map(c => c.name);
    expect(names).toContain("Fighting Style");
    expect(names).toContain("Spellcasting");
    expect(names).not.toContain("Extra Attack");
  });

  it("includes Extra Attack at level 5", () => {
    const caps = Ranger.capabilitiesForLevel!(5);
    const names = caps.map(c => c.name);
    expect(names).toContain("Extra Attack");
    expect(caps.find(c => c.name === "Extra Attack")!.economy).toBe("action");
  });
});

describe("Ranger combat text profile", () => {
  it("matches 'hunters mark' text", () => {
    const match = tryMatchClassAction("huntersmark", [RANGER_COMBAT_TEXT_PROFILE]);
    expect(match).not.toBeNull();
    expect(match!.abilityId).toBe("class:ranger:hunters-mark");
    expect(match!.category).toBe("bonusAction");
  });

  it("matches 'cast hunters mark' text", () => {
    const match = tryMatchClassAction("casthuntersmark", [RANGER_COMBAT_TEXT_PROFILE]);
    expect(match).not.toBeNull();
    expect(match!.abilityId).toBe("class:ranger:hunters-mark");
  });

  it("does not match unrelated text", () => {
    const match = tryMatchClassAction("attack", [RANGER_COMBAT_TEXT_PROFILE]);
    expect(match).toBeNull();
  });
});
