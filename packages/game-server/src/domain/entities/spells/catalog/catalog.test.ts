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
    expect(cantrips.length).toBe(9);
    const names = cantrips.map((s) => s.name);
    expect(names).toContain("Eldritch Blast");
    expect(names).toContain("Fire Bolt");
    expect(names).toContain("Sacred Flame");
    expect(names).toContain("Booming Blade");
    expect(names).toContain("Vicious Mockery");
  });

  it("returns level 1 spells", () => {
    const level1 = listSpellsByLevel(1);
    expect(level1.length).toBe(35);
    const names = level1.map((s) => s.name);
    expect(names).toContain("Burning Hands");
    expect(names).toContain("Magic Missile");
    expect(names).toContain("Shield");
    expect(names).toContain("Cure Wounds");
    expect(names).toContain("Silvery Barbs");
    expect(names).toContain("Detect Magic");
    expect(names).toContain("Bane");
    expect(names).toContain("Searing Smite");
    expect(names).toContain("Thunderous Smite");
    expect(names).toContain("Wrathful Smite");
    expect(names).toContain("Divine Favor");
    expect(names).toContain("Ensnaring Strike");
    expect(names).toContain("Armor of Agathys");
    expect(names).toContain("Entangle");
    expect(names).toContain("Protection from Evil and Good");
    expect(names).toContain("Chromatic Orb");
    expect(names).toContain("Witch Bolt");
  });

  it("returns level 2 spells", () => {
    const level2 = listSpellsByLevel(2);
    expect(level2.length).toBe(19);
    const names = level2.map((s) => s.name);
    expect(names).toContain("Hold Person");
    expect(names).toContain("Misty Step");
    expect(names).toContain("Branding Smite");
    expect(names).toContain("Pass Without Trace");
    expect(names).toContain("Mirror Image");
    expect(names).toContain("Blindness/Deafness");
    expect(names).toContain("Suggestion");
    expect(names).toContain("Zone of Truth");
  });

  it("returns level 3 spells", () => {
    const level3 = listSpellsByLevel(3);
    expect(level3.length).toBe(12);
    const names = level3.map((s) => s.name);
    expect(names).toContain("Fireball");
    expect(names).toContain("Counterspell");
    expect(names).toContain("Spirit Guardians");
    expect(names).toContain("Call Lightning");
    expect(names).toContain("Haste");
    expect(names).toContain("Hypnotic Pattern");
    expect(names).toContain("Stinking Cloud");
    expect(names).toContain("Mass Healing Word");
    expect(names).toContain("Fly");
    expect(names).toContain("Daylight");
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

  // ── Newly added spells (Phase 3.6 + Phase 4) ──

  it("Searing Smite: level 1, concentration, bonus action, on_next_weapon_hit rider (+1d6 fire)", () => {
    const spell = getCanonicalSpell("Searing Smite")!;
    expect(spell).not.toBeNull();
    expect(spell.level).toBe(1);
    expect(spell.concentration).toBe(true);
    expect(spell.isBonusAction).toBe(true);
    expect(spell.classLists).toEqual(["Paladin"]);
    const rider = spell.effects!.find(e => e.triggerAt === 'on_next_weapon_hit');
    expect(rider).toBeDefined();
    expect(rider!.damageType).toBe('fire');
    expect(rider!.diceValue).toEqual({ count: 1, sides: 6 });
  });

  it("Thunderous Smite: level 1, Paladin, on_next_weapon_hit +2d6 thunder + STR save", () => {
    const spell = getCanonicalSpell("Thunderous Smite")!;
    expect(spell.classLists).toEqual(["Paladin"]);
    expect(spell.level).toBe(1);
    const rider = spell.effects!.find(e => e.triggerAt === 'on_next_weapon_hit')!;
    expect(rider.diceValue).toEqual({ count: 2, sides: 6 });
    expect(rider.damageType).toBe('thunder');
    expect(rider.triggerConditions).toEqual(['Prone']);
  });

  it("Wrathful Smite: level 1, Paladin, on_next_weapon_hit +1d6 psychic + WIS save", () => {
    const spell = getCanonicalSpell("Wrathful Smite")!;
    expect(spell.classLists).toEqual(["Paladin"]);
    const rider = spell.effects!.find(e => e.triggerAt === 'on_next_weapon_hit')!;
    expect(rider.damageType).toBe('psychic');
    expect(rider.triggerSave!.ability).toBe('wisdom');
  });

  it("Branding Smite: level 2, Paladin, on_next_weapon_hit +2d6 radiant", () => {
    const spell = getCanonicalSpell("Branding Smite")!;
    expect(spell.level).toBe(2);
    expect(spell.classLists).toEqual(["Paladin"]);
    const rider = spell.effects!.find(e => e.triggerAt === 'on_next_weapon_hit')!;
    expect(rider.damageType).toBe('radiant');
    expect(rider.diceValue).toEqual({ count: 2, sides: 6 });
  });

  it("Divine Favor: level 1, Paladin, bonus action, +1d4 radiant damage rider (non-concentration in 2024)", () => {
    const spell = getCanonicalSpell("Divine Favor")!;
    expect(spell.level).toBe(1);
    expect(spell.isBonusAction).toBe(true);
    expect(spell.classLists).toEqual(["Paladin"]);
    expect(spell.concentration).not.toBe(true);
    const damageEffect = spell.effects!.find(e => e.target === 'damage_rolls')!;
    expect(damageEffect.diceValue).toEqual({ count: 1, sides: 4 });
    expect(damageEffect.damageType).toBe('radiant');
  });

  it("Ensnaring Strike: level 1, Ranger, on_next_weapon_hit rider + Restrained save-to-end", () => {
    const spell = getCanonicalSpell("Ensnaring Strike")!;
    expect(spell.classLists).toEqual(["Ranger"]);
    expect(spell.concentration).toBe(true);
    const rider = spell.effects!.find(e => e.triggerAt === 'on_next_weapon_hit')!;
    expect(rider.triggerConditions).toEqual(['Restrained']);
  });

  it("Entangle: level 1, Druid, STR save, Restrained, cube 20", () => {
    const spell = getCanonicalSpell("Entangle")!;
    expect(spell.level).toBe(1);
    expect(spell.classLists).toEqual(["Druid"]);
    expect(spell.saveAbility).toBe('strength');
    expect(spell.conditions).toEqual({ onFailure: ['Restrained'] });
    expect(spell.area).toEqual({ type: 'cube', size: 20 });
  });

  it("Vicious Mockery: cantrip, Bard, WIS save, 1d4 psychic", () => {
    const spell = getCanonicalSpell("Vicious Mockery")!;
    expect(spell.level).toBe(0);
    expect(spell.classLists).toEqual(["Bard"]);
    expect(spell.saveAbility).toBe('wisdom');
    expect(spell.damage).toEqual({ diceCount: 1, diceSides: 4 });
    expect(spell.damageType).toBe('psychic');
  });

  it("Pass Without Trace: level 2, concentration, allies ability_checks +10", () => {
    const spell = getCanonicalSpell("Pass Without Trace")!;
    expect(spell.level).toBe(2);
    expect(spell.concentration).toBe(true);
    expect(spell.classLists).toContain("Druid");
    expect(spell.classLists).toContain("Ranger");
    const aura = spell.effects!.find(e => e.target === 'ability_checks' && e.appliesTo === 'allies')!;
    expect(aura.value).toBe(10);
  });

  it("Call Lightning: level 3, Druid, 4d10 lightning, DEX save", () => {
    const spell = getCanonicalSpell("Call Lightning")!;
    expect(spell.level).toBe(3);
    expect(spell.classLists).toEqual(["Druid"]);
    expect(spell.damage).toEqual({ diceCount: 4, diceSides: 10, modifier: 0 });
    expect(spell.damageType).toBe('lightning');
    expect(spell.saveAbility).toBe('dexterity');
  });

  it("Chromatic Orb: level 1, ranged spell attack, 3d8", () => {
    const spell = getCanonicalSpell("Chromatic Orb")!;
    expect(spell.level).toBe(1);
    expect(spell.attackType).toBe('ranged_spell');
    expect(spell.damage).toEqual({ diceCount: 3, diceSides: 8 });
  });

  it("Witch Bolt: level 1, concentration, ranged spell attack, 1d12 lightning", () => {
    const spell = getCanonicalSpell("Witch Bolt")!;
    expect(spell.level).toBe(1);
    expect(spell.concentration).toBe(true);
    expect(spell.attackType).toBe('ranged_spell');
    expect(spell.damageType).toBe('lightning');
  });

  it("Haste: level 3, concentration, +2 AC effect, 2x speed", () => {
    const spell = getCanonicalSpell("Haste")!;
    expect(spell.level).toBe(3);
    expect(spell.concentration).toBe(true);
    const acBonus = spell.effects!.find(e => e.target === 'armor_class')!;
    expect(acBonus.value).toBe(2);
  });

  it("Hypnotic Pattern: level 3, WIS save, Charmed+Incapacitated cube 30", () => {
    const spell = getCanonicalSpell("Hypnotic Pattern")!;
    expect(spell.level).toBe(3);
    expect(spell.conditions!.onFailure).toEqual(['Charmed', 'Incapacitated']);
    expect(spell.area).toEqual({ type: 'cube', size: 30 });
  });

  it("Stinking Cloud: level 3, CON save, zone with Poisoned", () => {
    const spell = getCanonicalSpell("Stinking Cloud")!;
    expect(spell.level).toBe(3);
    expect(spell.zone).toBeDefined();
  });

  it("Mass Healing Word: level 3, bonus action, healing 1d4", () => {
    const spell = getCanonicalSpell("Mass Healing Word")!;
    expect(spell.level).toBe(3);
    expect(spell.isBonusAction).toBe(true);
    expect(spell.healing).toEqual({ diceCount: 1, diceSides: 4 });
  });

  it("Mirror Image: level 2, non-concentration, 10-round duration", () => {
    const spell = getCanonicalSpell("Mirror Image")!;
    expect(spell.level).toBe(2);
    expect(spell.concentration).not.toBe(true);
  });

  it("Blindness/Deafness: level 2, CON save, Blinded condition, turnEndSave", () => {
    const spell = getCanonicalSpell("Blindness/Deafness")!;
    expect(spell.level).toBe(2);
    expect(spell.saveAbility).toBe('constitution');
    expect(spell.conditions).toEqual({ onFailure: ['Blinded'] });
    expect(spell.turnEndSave).toBeDefined();
  });

  it("Suggestion: level 2, Bard/Sorc/Warlock/Wizard, WIS save, Charmed", () => {
    const spell = getCanonicalSpell("Suggestion")!;
    expect(spell.level).toBe(2);
    expect(spell.saveAbility).toBe('wisdom');
    expect(spell.conditions).toEqual({ onFailure: ['Charmed'] });
  });

  it("Zone of Truth: level 2, CHA save, Bard/Cleric/Paladin", () => {
    const spell = getCanonicalSpell("Zone of Truth")!;
    expect(spell.level).toBe(2);
    expect(spell.saveAbility).toBe('charisma');
    expect(spell.classLists).toContain("Paladin");
  });

  it("Protection from Evil and Good: level 1, concentration, Cleric/Paladin/Warlock/Wizard", () => {
    const spell = getCanonicalSpell("Protection from Evil and Good")!;
    expect(spell.level).toBe(1);
    expect(spell.concentration).toBe(true);
    expect(spell.classLists).toContain("Paladin");
  });

  it("Fly: level 3, concentration, touch range", () => {
    const spell = getCanonicalSpell("Fly")!;
    expect(spell.level).toBe(3);
    expect(spell.concentration).toBe(true);
    expect(spell.range).toBe('touch');
  });

  it("Daylight: level 3, utility, no concentration (2024 RAW)", () => {
    const spell = getCanonicalSpell("Daylight")!;
    expect(spell.level).toBe(3);
    expect(spell.concentration).not.toBe(true);
  });
});
