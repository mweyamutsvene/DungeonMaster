import { describe, it, expect } from "vitest";
import {
  getCanonicalSpell,
  listSpellsByLevel,
  listSpellsByClass,
} from "./index.js";

// ─────────────────────── getCanonicalSpell ──────────────────────────

describe("getCanonicalSpell", () => {
  it("returns correct spell for exact name match", () => {
    const spell = getCanonicalSpell("Fire Bolt");
    expect(spell).not.toBeNull();
    expect(spell!.name).toBe("Fire Bolt");
    expect(spell!.level).toBe(0);
  });

  it("returns correct spell for case-insensitive lookup (lowercase)", () => {
    const spell = getCanonicalSpell("fire bolt");
    expect(spell).not.toBeNull();
    expect(spell!.name).toBe("Fire Bolt");
  });

  it("returns correct spell for case-insensitive lookup (uppercase)", () => {
    const spell = getCanonicalSpell("FIRE BOLT");
    expect(spell).not.toBeNull();
    expect(spell!.name).toBe("Fire Bolt");
  });

  it("returns correct spell for mixed-case lookup", () => {
    const spell = getCanonicalSpell("bUrNiNg HaNdS");
    expect(spell).not.toBeNull();
    expect(spell!.name).toBe("Burning Hands");
  });

  it("returns null for unknown spell", () => {
    expect(getCanonicalSpell("Wish")).toBeNull();
    expect(getCanonicalSpell("Power Word Kill")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(getCanonicalSpell("")).toBeNull();
  });
});

// ─────────────────────── listSpellsByLevel ───────────────────────────

describe("listSpellsByLevel", () => {
  it("returns cantrips (level 0) including Eldritch Blast and Fire Bolt", () => {
    const cantrips = listSpellsByLevel(0);
    expect(cantrips.length).toBe(8);
    const names = cantrips.map((s) => s.name);
    expect(names).toContain("Eldritch Blast");
    expect(names).toContain("Fire Bolt");
    expect(names).toContain("Sacred Flame");
    expect(names).toContain("Booming Blade");
  });

  it("returns level 1 spells", () => {
    const level1 = listSpellsByLevel(1);
    expect(level1.length).toBe(22);
    const names = level1.map((s) => s.name);
    expect(names).toContain("Burning Hands");
    expect(names).toContain("Magic Missile");
    expect(names).toContain("Shield");
    expect(names).toContain("Cure Wounds");
  });

  it("returns level 2 spells", () => {
    const level2 = listSpellsByLevel(2);
    expect(level2.length).toBe(13);
    const names = level2.map((s) => s.name);
    expect(names).toContain("Hold Person");
    expect(names).toContain("Misty Step");
  });

  it("returns level 3 spells", () => {
    const level3 = listSpellsByLevel(3);
    expect(level3.length).toBe(5);
    const names = level3.map((s) => s.name);
    expect(names).toContain("Fireball");
    expect(names).toContain("Counterspell");
    expect(names).toContain("Spirit Guardians");
  });

  it("returns empty array for level with no spells (level 9)", () => {
    expect(listSpellsByLevel(9)).toEqual([]);
  });

  it("returns empty array for negative level", () => {
    expect(listSpellsByLevel(-1)).toEqual([]);
  });
});

// ─────────────────────── listSpellsByClass ───────────────────────────

describe("listSpellsByClass", () => {
  it("Wizard spells include Fire Bolt, Burning Hands, Shield, Magic Missile", () => {
    const wizardSpells = listSpellsByClass("Wizard");
    const names = wizardSpells.map((s) => s.name);
    expect(names).toContain("Fire Bolt");
    expect(names).toContain("Burning Hands");
    expect(names).toContain("Shield");
    expect(names).toContain("Magic Missile");
    expect(names).toContain("Fireball");
    expect(names).toContain("Counterspell");
  });

  it("Cleric spells include Sacred Flame, Cure Wounds, Bless, Spirit Guardians", () => {
    const clericSpells = listSpellsByClass("Cleric");
    const names = clericSpells.map((s) => s.name);
    expect(names).toContain("Sacred Flame");
    expect(names).toContain("Cure Wounds");
    expect(names).toContain("Bless");
    expect(names).toContain("Spirit Guardians");
    expect(names).toContain("Guiding Bolt");
  });

  it("case-insensitive class lookup", () => {
    const lower = listSpellsByClass("wizard");
    const upper = listSpellsByClass("WIZARD");
    const mixed = listSpellsByClass("wIzArD");
    expect(lower.length).toBe(upper.length);
    expect(lower.length).toBe(mixed.length);
    expect(lower.length).toBeGreaterThan(0);
  });

  it("returns empty for unknown class", () => {
    expect(listSpellsByClass("Artificer")).toEqual([]);
    expect(listSpellsByClass("")).toEqual([]);
  });

  it("Warlock spells include Eldritch Blast and Hellish Rebuke", () => {
    const warlockSpells = listSpellsByClass("Warlock");
    const names = warlockSpells.map((s) => s.name);
    expect(names).toContain("Eldritch Blast");
    expect(names).toContain("Hellish Rebuke");
    expect(names).toContain("Counterspell");
  });
});

// ─────────────────────── Spot-check canonical spell data ────────────

describe("canonical spell data (D&D 5e 2024 rules)", () => {
  it("Fire Bolt: level 0, ranged_spell attack, 1d10 fire, evocation", () => {
    const spell = getCanonicalSpell("Fire Bolt")!;
    expect(spell).not.toBeNull();
    expect(spell.level).toBe(0);
    expect(spell.attackType).toBe("ranged_spell");
    expect(spell.damage).toEqual({ diceCount: 1, diceSides: 10, modifier: 0 });
    expect(spell.damageType).toBe("fire");
    expect(spell.school).toBe("evocation");
    expect(spell.range).toBe(120);
  });

  it("Burning Hands: level 1, DEX save, 3d6 fire, halfDamageOnSave, cone 15", () => {
    const spell = getCanonicalSpell("Burning Hands")!;
    expect(spell).not.toBeNull();
    expect(spell.level).toBe(1);
    expect(spell.saveAbility).toBe("dexterity");
    expect(spell.damage).toEqual({ diceCount: 3, diceSides: 6, modifier: 0 });
    expect(spell.damageType).toBe("fire");
    expect(spell.halfDamageOnSave).toBe(true);
    expect(spell.area).toEqual({ type: "cone", size: 15 });
    expect(spell.school).toBe("evocation");
  });

  it("Cure Wounds: level 1, healing 2d8 (2024 rules), touch range", () => {
    const spell = getCanonicalSpell("Cure Wounds")!;
    expect(spell).not.toBeNull();
    expect(spell.level).toBe(1);
    expect(spell.healing).toEqual({ diceCount: 2, diceSides: 8 });
    expect(spell.range).toBe("touch");
    expect(spell.school).toBe("abjuration");
  });

  it("Magic Missile: level 1, evocation, 120 range, force damage", () => {
    const spell = getCanonicalSpell("Magic Missile")!;
    expect(spell).not.toBeNull();
    expect(spell.level).toBe(1);
    expect(spell.school).toBe("evocation");
    expect(spell.range).toBe(120);
    expect(spell.damageType).toBe("force");
    expect(spell.damage).toEqual({ diceCount: 1, diceSides: 4, modifier: 1 });
  });

  it("Shield: level 1, reaction, self range, abjuration", () => {
    const spell = getCanonicalSpell("Shield")!;
    expect(spell).not.toBeNull();
    expect(spell.level).toBe(1);
    expect(spell.castingTime).toBe("reaction");
    expect(spell.range).toBe("self");
    expect(spell.school).toBe("abjuration");
  });

  it("Counterspell: level 3, reaction, abjuration", () => {
    const spell = getCanonicalSpell("Counterspell")!;
    expect(spell).not.toBeNull();
    expect(spell.level).toBe(3);
    expect(spell.castingTime).toBe("reaction");
    expect(spell.school).toBe("abjuration");
    expect(spell.range).toBe(60);
  });

  it("Spirit Guardians: level 3, concentration true, conjuration", () => {
    const spell = getCanonicalSpell("Spirit Guardians")!;
    expect(spell).not.toBeNull();
    expect(spell.level).toBe(3);
    expect(spell.concentration).toBe(true);
    expect(spell.school).toBe("conjuration");
    expect(spell.range).toBe("self");
    expect(spell.zone).toBeDefined();
    expect(spell.zone!.type).toBe("aura");
    expect(spell.zone!.radiusFeet).toBe(15);
  });

  it("Eldritch Blast: level 0, ranged_spell, 1d10 force, warlock only", () => {
    const spell = getCanonicalSpell("Eldritch Blast")!;
    expect(spell).not.toBeNull();
    expect(spell.level).toBe(0);
    expect(spell.attackType).toBe("ranged_spell");
    expect(spell.damage).toEqual({ diceCount: 1, diceSides: 10 });
    expect(spell.damageType).toBe("force");
    expect(spell.classLists).toEqual(["Warlock"]);
  });

  it("Fireball: level 3, DEX save, 8d6 fire, sphere 20, half on save", () => {
    const spell = getCanonicalSpell("Fireball")!;
    expect(spell).not.toBeNull();
    expect(spell.level).toBe(3);
    expect(spell.saveAbility).toBe("dexterity");
    expect(spell.damage).toEqual({ diceCount: 8, diceSides: 6 });
    expect(spell.damageType).toBe("fire");
    expect(spell.halfDamageOnSave).toBe(true);
    expect(spell.area).toEqual({ type: "sphere", size: 20 });
    expect(spell.school).toBe("evocation");
  });

  it("Hold Person: level 2, concentration, WIS save, Paralyzed condition", () => {
    const spell = getCanonicalSpell("Hold Person")!;
    expect(spell).not.toBeNull();
    expect(spell.level).toBe(2);
    expect(spell.concentration).toBe(true);
    expect(spell.saveAbility).toBe("wisdom");
    expect(spell.conditions).toEqual({ onFailure: ["Paralyzed"] });
  });
});
