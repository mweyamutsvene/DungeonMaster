/**
 * Canonical Level 4 Spell Catalog — D&D 5e 2024
 *
 * High-impact combat spells for levels 7–8+ characters.
 *
 * Layer: Domain (pure data, no side effects).
 */

import type { CanonicalSpell } from './types.js';

export const WALL_OF_FIRE = {
  name: 'Wall of Fire',
  level: 4,
  concentration: true,
  saveAbility: 'dexterity',
  halfDamageOnSave: true,
  zone: {
    type: 'placed' as const,
    radiusFeet: 60, // 60 feet long, 20 feet high, 1 foot thick (or ringed: 20ft diameter)
    shape: 'line' as const,
    width: 1,
    effects: [
      {
        trigger: 'on_enter' as const,
        damage: { diceCount: 5, diceSides: 8, modifier: 0 },
        damageType: 'fire',
        saveAbility: 'dexterity',
        halfDamageOnSave: true,
        affectsEnemies: true,
        affectsAllies: true,
        affectsSelf: true,
      },
      {
        trigger: 'on_end_turn' as const,
        damage: { diceCount: 5, diceSides: 8, modifier: 0 },
        damageType: 'fire',
        saveAbility: 'dexterity',
        halfDamageOnSave: true,
        affectsEnemies: true,
        affectsAllies: true,
        affectsSelf: true,
      },
    ],
  },
  upcastScaling: { additionalDice: { diceCount: 1, diceSides: 8 } },
  school: 'evocation',
  castingTime: 'action',
  range: 120,
  components: { v: true, s: true, m: 'a small piece of phosphorus' },
  classLists: ['Druid', 'Sorcerer', 'Wizard'],
  description: 'A wall of fire up to 60 feet long. One side deals 5d8 fire damage (DEX save for half) to creatures within 10 feet or passing through.',
} as const satisfies CanonicalSpell;

export const BANISHMENT = {
  name: 'Banishment',
  level: 4,
  concentration: true,
  saveAbility: 'charisma',
  conditions: { onFailure: ['Incapacitated'] },
  school: 'abjuration',
  castingTime: 'action',
  range: 60,
  components: { v: true, s: true, m: 'an item distasteful to the target' },
  classLists: ['Cleric', 'Paladin', 'Sorcerer', 'Warlock', 'Wizard'],
  description: 'Banish a creature to a harmless demiplane. CHA save or be incapacitated and removed from play. If concentration holds for 1 minute, extraplanar creatures are permanently banished. +1 target per slot level above 4th.',
} as const satisfies CanonicalSpell;

export const POLYMORPH = {
  name: 'Polymorph',
  level: 4,
  concentration: true,
  saveAbility: 'wisdom',
  school: 'transmutation',
  castingTime: 'action',
  range: 60,
  components: { v: true, s: true, m: 'a caterpillar cocoon' },
  classLists: ['Bard', 'Druid', 'Sorcerer', 'Wizard'],
  description: 'Transform a creature into a beast of CR equal to or lower than its level/CR. WIS save (unwilling). The target gains the beast\'s stats but retains its alignment and personality. Reverts when reduced to 0 HP.',
} as const satisfies CanonicalSpell;

export const GREATER_INVISIBILITY = {
  name: 'Greater Invisibility',
  level: 4,
  concentration: true,
  effects: [
    {
      type: 'custom' as const,
      target: 'custom' as const,
      conditionName: 'Invisible',
      duration: 'concentration' as const,
      appliesTo: 'target' as const,
    },
  ],
  school: 'illusion',
  castingTime: 'action',
  range: 'touch',
  components: { v: true, s: true },
  classLists: ['Bard', 'Sorcerer', 'Wizard'],
  description: 'Target becomes Invisible for the duration. Unlike Invisibility, does NOT end when the target attacks or casts a spell.',
} as const satisfies CanonicalSpell;

export const ICE_STORM = {
  name: 'Ice Storm',
  level: 4,
  saveAbility: 'dexterity',
  damage: { diceCount: 2, diceSides: 8, modifier: 0 },
  damageType: 'bludgeoning',
  halfDamageOnSave: true,
  area: { type: 'sphere' as const, size: 20 },
  effects: [
    {
      type: 'custom' as const,
      target: 'custom' as const,
      value: 0,
      duration: 'rounds' as const,
      roundsRemaining: 1,
      appliesTo: 'target' as const,
      // Additionally deals 4d6 cold damage (combined in single save)
    },
  ],
  upcastScaling: { additionalDice: { diceCount: 1, diceSides: 8 } },
  school: 'evocation',
  castingTime: 'action',
  range: 300,
  components: { v: true, s: true, m: 'a pinch of dust and a few drops of water' },
  classLists: ['Druid', 'Sorcerer', 'Wizard'],
  description: 'A hail of rock-hard ice in a 20-foot-radius, 40-foot-high cylinder. 2d8 bludgeoning + 4d6 cold damage (DEX save for half). Area becomes difficult terrain until end of your next turn.',
} as const satisfies CanonicalSpell;

export const DIMENSION_DOOR = {
  name: 'Dimension Door',
  level: 4,
  effects: [
    {
      type: 'custom' as const,
      target: 'custom' as const,
      value: 500, // Teleport distance in feet
      duration: 'instant' as const,
      appliesTo: 'self' as const,
    },
  ],
  school: 'conjuration',
  castingTime: 'action',
  range: 500,
  components: { v: true },
  classLists: ['Bard', 'Sorcerer', 'Warlock', 'Wizard'],
  description: 'Teleport yourself and one willing creature within 5 feet to a location up to 500 feet away that you can visualize or describe by direction and distance.',
} as const satisfies CanonicalSpell;

export const LEVEL_4_CATALOG: readonly CanonicalSpell[] = [
  BANISHMENT,
  DIMENSION_DOOR,
  GREATER_INVISIBILITY,
  ICE_STORM,
  POLYMORPH,
  WALL_OF_FIRE,
];
