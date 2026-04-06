/**
 * Canonical Level 2 Spell Catalog — D&D 5e 2024
 *
 * Each entry is the single source of truth for that spell's mechanics.
 * Zone saveDC is omitted — it depends on the caster's spell save DC and is
 * filled in at cast time by the combat system.
 *
 * Layer: Domain (pure data, no side effects).
 */

import type { CanonicalSpell } from './types.js';

export const CLOUD_OF_DAGGERS = {
  name: 'Cloud of Daggers',
  level: 2,
  concentration: true,
  zone: {
    type: 'placed' as const,
    radiusFeet: 5,
    shape: 'circle' as const,
    effects: [
      {
        trigger: 'on_start_turn' as const,
        damage: { diceCount: 4, diceSides: 4, modifier: 0 },
        damageType: 'slashing',
        affectsEnemies: true,
        affectsAllies: true,
        affectsSelf: true,
      },
    ],
  },
  upcastScaling: { additionalDice: { diceCount: 2, diceSides: 4 } },
  school: 'conjuration',
  castingTime: 'action',
  range: 60,
  components: { v: true, s: true, m: 'a sliver of glass' },
  classLists: ['Bard', 'Sorcerer', 'Warlock', 'Wizard'],
  description: 'A cloud of spinning daggers in a 5-foot cube. No save — automatic damage.',
} as const satisfies CanonicalSpell;

export const HOLD_PERSON = {
  name: 'Hold Person',
  level: 2,
  concentration: true,
  saveAbility: 'wisdom',
  conditions: { onFailure: ['Paralyzed'] },
  school: 'enchantment',
  castingTime: 'action',
  range: 60,
  components: { v: true, s: true, m: 'a straight piece of iron' },
  classLists: ['Bard', 'Cleric', 'Druid', 'Sorcerer', 'Warlock', 'Wizard'],
  description: 'A humanoid must succeed on a WIS save or be paralyzed. Repeats save at end of each turn. +1 target per slot level above 2nd.',
} as const satisfies CanonicalSpell;

export const MISTY_STEP = {
  name: 'Misty Step',
  level: 2,
  isBonusAction: true,
  school: 'conjuration',
  castingTime: 'bonus_action',
  range: 'self',
  components: { v: true },
  classLists: ['Bard', 'Sorcerer', 'Warlock', 'Wizard'],
  description: 'Teleport up to 30 feet to an unoccupied space you can see.',
} as const satisfies CanonicalSpell;

export const MOONBEAM = {
  name: 'Moonbeam',
  level: 2,
  concentration: true,
  zone: {
    type: 'placed' as const,
    radiusFeet: 5,
    shape: 'circle' as const,
    effects: [
      {
        trigger: 'on_start_turn' as const,
        damage: { diceCount: 2, diceSides: 10, modifier: 0 },
        damageType: 'radiant',
        saveAbility: 'constitution',
        halfDamageOnSave: true,
        affectsEnemies: true,
        affectsAllies: true,
        affectsSelf: true,
      },
    ],
  },
  upcastScaling: { additionalDice: { diceCount: 1, diceSides: 10 } },
  school: 'evocation',
  castingTime: 'action',
  range: 120,
  components: { v: true, s: true, m: 'a moonseed leaf' },
  classLists: ['Druid'],
  description: 'A silvery beam of pale light in a 5-foot radius, 40-foot high cylinder. CON save for radiant damage.',
} as const satisfies CanonicalSpell;

export const SCORCHING_RAY = {
  name: 'Scorching Ray',
  level: 2,
  attackType: 'ranged_spell',
  damage: { diceCount: 2, diceSides: 6 },
  damageType: 'fire',
  // Each ray deals 2d6. Base: 3 rays. +1 ray per slot level above 2nd.
  // upcastScaling here represents per-ray bonus; ray count handled by spell-specific logic.
  school: 'evocation',
  castingTime: 'action',
  range: 120,
  components: { v: true, s: true },
  classLists: ['Sorcerer', 'Wizard'],
  description: 'Three fiery rays, each dealing 2d6 fire. Make a ranged spell attack per ray. +1 ray per slot level above 2nd.',
} as const satisfies CanonicalSpell;

export const SHATTER = {
  name: 'Shatter',
  level: 2,
  saveAbility: 'constitution',
  damage: { diceCount: 3, diceSides: 8 },
  damageType: 'thunder',
  halfDamageOnSave: true,
  area: { type: 'sphere' as const, size: 10 },
  upcastScaling: { additionalDice: { diceCount: 1, diceSides: 8 } },
  school: 'evocation',
  castingTime: 'action',
  range: 60,
  components: { v: true, s: true, m: 'a chip of mica' },
  classLists: ['Bard', 'Sorcerer', 'Wizard'],
  description: 'A loud noise erupts in a 10-foot-radius sphere. Constructs have disadvantage on the save.',
} as const satisfies CanonicalSpell;

export const SPIKE_GROWTH = {
  name: 'Spike Growth',
  level: 2,
  concentration: true,
  zone: {
    type: 'placed' as const,
    radiusFeet: 20,
    shape: 'circle' as const,
    effects: [
      {
        trigger: 'per_5ft_moved' as const,
        damage: { diceCount: 2, diceSides: 4, modifier: 0 },
        damageType: 'piercing',
        affectsEnemies: true,
        affectsAllies: true,
        affectsSelf: true,
      },
    ],
  },
  school: 'transmutation',
  castingTime: 'action',
  range: 150,
  components: { v: true, s: true, m: 'seven thorns' },
  classLists: ['Druid', 'Ranger'],
  description: 'The ground sprouts hard spikes. 2d4 piercing per 5 feet moved within the area. Camouflaged terrain.',
} as const satisfies CanonicalSpell;

export const SPIRITUAL_WEAPON = {
  name: 'Spiritual Weapon',
  level: 2,
  concentration: true,
  isBonusAction: true,
  attackType: 'melee_spell',
  damage: { diceCount: 1, diceSides: 8 },
  damageType: 'force',
  upcastScaling: { additionalDice: { diceCount: 1, diceSides: 8 } },
  school: 'evocation',
  castingTime: 'bonus_action',
  range: 60,
  components: { v: true, s: true },
  classLists: ['Cleric'],
  description: 'A floating spectral weapon that attacks for 1d8 + spellcasting modifier force damage. Move and repeat as bonus action.',
} as const satisfies CanonicalSpell;

export const LEVEL_2_CATALOG: readonly CanonicalSpell[] = [
  CLOUD_OF_DAGGERS,
  HOLD_PERSON,
  MISTY_STEP,
  MOONBEAM,
  SCORCHING_RAY,
  SHATTER,
  SPIKE_GROWTH,
  SPIRITUAL_WEAPON,
];
