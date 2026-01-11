import { describe, expect, it } from "vitest";

import { AbilityScores } from "../entities/core/ability-scores.js";
import { Character } from "../entities/creatures/character.js";
import { NPC } from "../entities/creatures/npc.js";
import { DamageEffect } from "../effects/damage-effect.js";
import { Spell } from "../entities/spells/spell.js";
import { createConcentrationState } from "./concentration.js";
import { castSpell } from "./spell-resolver.js";
import { createSpellSlotsState } from "./spell-slots.js";

function makeNpc(id: string): NPC {
  return new NPC({
    id,
    name: id,
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
    proficiencyBonus: 2,
  });
}

describe("spell-resolver", () => {
  it("casts a cantrip without spell slots", () => {
    const caster = makeNpc("caster");
    const target = makeNpc("target");

    const spell = new Spell({ id: "cantrip", name: "Cantrip", level: 0 });

    const result = castSpell({
      caster,
      spell,
      targets: [target],
      effects: [new DamageEffect({ amount: 2 })],
    });

    expect(result.slotSpent).toBe(null);
    expect(target.getCurrentHP()).toBe(8);
  });

  it("spends a slot for leveled spells and can start concentration", () => {
    const caster = makeNpc("caster");
    const target = makeNpc("target");

    const spell = new Spell({ id: "spell_1", name: "Spell", level: 1 });
    const slots = createSpellSlotsState({ 1: { current: 1, max: 1 } });

    const result = castSpell({
      caster,
      spell,
      targets: [target],
      spellSlots: slots,
      concentration: {
        state: createConcentrationState(),
        requiresConcentration: true,
      },
      effects: [new DamageEffect({ amount: 3 })],
    });

    expect(result.slotSpent).toBe(1);
    expect(result.nextSpellSlots?.[1].current).toBe(0);
    expect(result.nextConcentration?.activeSpellId).toBe("spell_1");
    expect(target.getCurrentHP()).toBe(7);
  });

  it("prevents casting spells while wearing untrained armor", () => {
    const caster = new Character({
      id: "caster",
      name: "Caster",
      maxHP: 10,
      currentHP: 10,
      armorClass: 10,
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
      characterClass: "wizard",
      classId: "wizard",
      experiencePoints: 0,
      armorTraining: { medium: false },
      equipment: {
        armor: {
          name: "Chain Shirt",
          category: "medium",
          armorClass: { base: 13, addDexterityModifier: true, dexterityModifierMax: 2 },
        },
      },
    });

    const target = makeNpc("target");
    const spell = new Spell({ id: "spell_1", name: "Spell", level: 1 });
    const slots = createSpellSlotsState({ 1: { current: 1, max: 1 } });

    expect(() =>
      castSpell({
        caster,
        spell,
        targets: [target],
        spellSlots: slots,
        effects: [new DamageEffect({ amount: 3 })],
      }),
    ).toThrow(/armor without training/i);

    expect(target.getCurrentHP()).toBe(10);
  });
});
