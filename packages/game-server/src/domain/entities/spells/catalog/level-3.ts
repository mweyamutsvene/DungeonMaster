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

export const LEVEL_3_CATALOG: readonly CanonicalSpell[] = [
  COUNTERSPELL,
  DISPEL_MAGIC,
  FIREBALL,
  REVIVIFY,
  SPIRIT_GUARDIANS,
];
