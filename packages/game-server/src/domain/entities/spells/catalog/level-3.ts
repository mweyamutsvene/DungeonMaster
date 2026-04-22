/**
 * Canonical Level 3 Spell Catalog — D&D 5e 2024
 *
 * Includes Spirit Guardians (level 3, not level 2 as sometimes miscategorized).
 * Mass Cure Wounds is level 5 — not included here (will go in a level-5.ts when needed).
 *
 * Layer: Domain (pure data, no side effects).
 */

import type { CanonicalSpell } from './types.js';

export const COUNTERSPELL = {
  name: 'Counterspell',
  level: 3,
  saveAbility: 'constitution',
  school: 'abjuration',
  castingTime: 'reaction',
  range: 60,
  components: { s: true },
  classLists: ['Sorcerer', 'Warlock', 'Wizard'],
  description: 'Interrupt a spell being cast. Target makes a CON save or the spell fails and the slot is not expended.',
} as const satisfies CanonicalSpell;

export const DISPEL_MAGIC = {
  name: 'Dispel Magic',
  level: 3,
  effects: [
    {
      type: 'custom' as const,
      target: 'custom' as const,
      value: 3, // Auto-dispels spells of this level or lower; higher requires ability check DC 10 + spell level
      duration: 'instant' as const,
      appliesTo: 'target' as const,
    },
  ],
  school: 'abjuration',
  castingTime: 'action',
  range: 120,
  components: { v: true, s: true },
  classLists: ['Bard', 'Cleric', 'Druid', 'Paladin', 'Ranger', 'Sorcerer', 'Warlock', 'Wizard'],
  description: 'End spells of level 3 or lower on a target. Higher-level spells require a spellcasting ability check (DC 10 + spell level).',
} as const satisfies CanonicalSpell;

export const FIREBALL = {
  name: 'Fireball',
  level: 3,
  saveAbility: 'dexterity',
  damage: { diceCount: 8, diceSides: 6 },
  damageType: 'fire',
  halfDamageOnSave: true,
  area: { type: 'sphere' as const, size: 20 },
  upcastScaling: { additionalDice: { diceCount: 1, diceSides: 6 } },
  school: 'evocation',
  castingTime: 'action',
  range: 150,
  components: { v: true, s: true, m: 'a ball of bat guano and sulfur' },
  classLists: ['Sorcerer', 'Wizard'],
  description: 'A fiery explosion in a 20-foot-radius sphere. DEX save for half.',
} as const satisfies CanonicalSpell;

export const REVIVIFY = {
  name: 'Revivify',
  level: 3,
  healing: { diceCount: 0, diceSides: 0, modifier: 1 },
  school: 'necromancy',
  castingTime: 'action',
  range: 'touch',
  components: { v: true, s: true, m: 'a diamond worth 300+ GP, consumed' },
  classLists: ['Cleric', 'Druid', 'Paladin', 'Ranger'],
  description: 'Touch a creature dead less than 1 minute. It revives with 1 HP.',
} as const satisfies CanonicalSpell;

export const SPIRIT_GUARDIANS = {
  name: 'Spirit Guardians',
  level: 3,
  concentration: true,
  zone: {
    type: 'aura' as const,
    radiusFeet: 15,
    shape: 'circle' as const,
    attachToSelf: true,
    effects: [
      {
        trigger: 'on_start_turn' as const,
        damage: { diceCount: 3, diceSides: 8, modifier: 0 },
        damageType: 'radiant',
        saveAbility: 'wisdom',
        halfDamageOnSave: true,
        affectsEnemies: true,
        affectsAllies: false,
        affectsSelf: false,
      },
      {
        trigger: 'on_enter' as const,
        damage: { diceCount: 3, diceSides: 8, modifier: 0 },
        damageType: 'radiant',
        saveAbility: 'wisdom',
        halfDamageOnSave: true,
        affectsEnemies: true,
        affectsAllies: false,
        affectsSelf: false,
      },
    ],
  },
  upcastScaling: { additionalDice: { diceCount: 1, diceSides: 8 } },
  school: 'conjuration',
  castingTime: 'action',
  range: 'self',
  components: { v: true, s: true, m: 'a prayer scroll' },
  classLists: ['Cleric'],
  description: 'Protective spirits in a 15-foot emanation. Enemies take 3d8 radiant (WIS save for half) and have halved speed.',
} as const satisfies CanonicalSpell;

// ── Additional L3 spells (2024 RAW) ──

export const CALL_LIGHTNING = {
  name: 'Call Lightning',
  level: 3,
  concentration: true,
  saveAbility: 'dexterity',
  damage: { diceCount: 4, diceSides: 10, modifier: 0 },
  damageType: 'lightning',
  halfDamageOnSave: true,
  area: { type: 'cylinder' as const, size: 5 },
  upcastScaling: { additionalDice: { diceCount: 1, diceSides: 10 } },
  school: 'conjuration',
  castingTime: 'action',
  range: 120,
  components: { v: true, s: true },
  classLists: ['Druid'],
  description: 'A storm cloud 100 feet above. On cast and on each of your subsequent turns (action, no slot) you can call a lightning bolt to a point below: each creature within 5 feet of that point makes a DEX save or takes 4d10 lightning (half on success).',
} as const satisfies CanonicalSpell;

export const HASTE = {
  name: 'Haste',
  level: 3,
  concentration: true,
  effects: [
    {
      type: 'bonus' as const,
      target: 'armor_class' as const,
      value: 2,
      duration: 'concentration' as const,
      appliesTo: 'target' as const,
    },
    {
      type: 'advantage' as const,
      target: 'saving_throws' as const,
      ability: 'dexterity',
      duration: 'concentration' as const,
      appliesTo: 'target' as const,
    },
    {
      type: 'speed_multiplier' as const,
      target: 'speed' as const,
      value: 2,
      duration: 'concentration' as const,
      appliesTo: 'target' as const,
    },
  ],
  school: 'transmutation',
  castingTime: 'action',
  range: 30,
  components: { v: true, s: true, m: 'a shaving of licorice root' },
  classLists: ['Sorcerer', 'Wizard'],
  description: 'Target\'s speed doubles, +2 AC, advantage on DEX saves, and one extra attack as an additional action. Dazed when concentration ends.',
} as const satisfies CanonicalSpell;

export const HYPNOTIC_PATTERN = {
  name: 'Hypnotic Pattern',
  level: 3,
  concentration: true,
  saveAbility: 'wisdom',
  conditions: { onFailure: ['Charmed', 'Incapacitated'] },
  area: { type: 'cube' as const, size: 30 },
  turnEndSave: { ability: 'wisdom', removeConditionOnSuccess: true },
  school: 'illusion',
  castingTime: 'action',
  range: 120,
  components: { s: true, m: 'a glowing stick of incense' },
  classLists: ['Bard', 'Sorcerer', 'Warlock', 'Wizard'],
  description: 'Twisting pattern of colors. Creatures in a 30-foot cube must make WIS save or be Charmed and Incapacitated (speed 0) for the duration. Ends if damaged; repeats save at end of each turn.',
} as const satisfies CanonicalSpell;

export const STINKING_CLOUD = {
  name: 'Stinking Cloud',
  level: 3,
  concentration: true,
  saveAbility: 'constitution',
  zone: {
    type: 'placed' as const,
    radiusFeet: 20,
    shape: 'circle' as const,
    effects: [
      {
        trigger: 'on_start_turn' as const,
        saveAbility: 'constitution',
        conditions: ['Poisoned'],
        affectsEnemies: true,
        affectsAllies: true,
        affectsSelf: true,
      },
    ],
  },
  school: 'conjuration',
  castingTime: 'action',
  range: 90,
  components: { v: true, s: true, m: 'a rotten egg or skunk cabbage' },
  classLists: ['Bard', 'Sorcerer', 'Wizard'],
  description: 'A 20-foot-radius sphere of yellow fog. Creatures starting turn in the cloud make CON save or be Poisoned and unable to take an action until start of their next turn.',
} as const satisfies CanonicalSpell;

export const MASS_HEALING_WORD = {
  name: 'Mass Healing Word',
  level: 3,
  healing: { diceCount: 1, diceSides: 4 },
  isBonusAction: true,
  upcastScaling: { additionalDice: { diceCount: 1, diceSides: 4 } },
  school: 'abjuration',
  castingTime: 'bonus_action',
  range: 60,
  components: { v: true },
  classLists: ['Bard', 'Cleric'],
  description: 'Up to 6 creatures of your choice within range regain 1d4 + spellcasting modifier HP each. +1d4 per slot level above 3rd.',
} as const satisfies CanonicalSpell;

export const FLY = {
  name: 'Fly',
  level: 3,
  concentration: true,
  school: 'transmutation',
  castingTime: 'action',
  range: 'touch',
  components: { v: true, s: true, m: 'a wing feather' },
  classLists: ['Sorcerer', 'Warlock', 'Wizard'],
  description: 'Target gains flying speed 60 ft for up to 10 minutes. +1 target per slot level above 3rd.',
} as const satisfies CanonicalSpell;

export const DAYLIGHT = {
  name: 'Daylight',
  level: 3,
  school: 'evocation',
  castingTime: 'action',
  range: 60,
  components: { v: true, s: true },
  classLists: ['Cleric', 'Druid', 'Paladin', 'Ranger', 'Sorcerer'],
  description: 'A 60-foot-radius sphere of light spreads from a point. Bright light in the sphere, dim light for another 60 feet. Dispels magical darkness of 3rd level or lower overlapping with the area.',
} as const satisfies CanonicalSpell;

export const LEVEL_3_CATALOG: readonly CanonicalSpell[] = [
  CALL_LIGHTNING,
  COUNTERSPELL,
  DAYLIGHT,
  DISPEL_MAGIC,
  FIREBALL,
  FLY,
  HASTE,
  HYPNOTIC_PATTERN,
  MASS_HEALING_WORD,
  REVIVIFY,
  SPIRIT_GUARDIANS,
  STINKING_CLOUD,
];
