/**
 * Canonical Level 5 Spell Catalog — D&D 5e 2024
 *
 * High-impact combat spells for levels 9–10+ characters.
 *
 * Layer: Domain (pure data, no side effects).
 */

import type { CanonicalSpell } from './types.js';

export const CONE_OF_COLD = {
  name: 'Cone of Cold',
  level: 5,
  saveAbility: 'constitution',
  damage: { diceCount: 8, diceSides: 8, modifier: 0 },
  damageType: 'cold',
  halfDamageOnSave: true,
  area: { type: 'cone' as const, size: 60 },
  upcastScaling: { additionalDice: { diceCount: 1, diceSides: 8 } },
  school: 'evocation',
  castingTime: 'action',
  range: 'self',
  components: { v: true, s: true, m: 'a small crystal or glass cone' },
  classLists: ['Druid', 'Sorcerer', 'Wizard'],
  description: 'A blast of cold air in a 60-foot cone. 8d8 cold damage (CON save for half).',
} as const satisfies CanonicalSpell;

export const HOLD_MONSTER = {
  name: 'Hold Monster',
  level: 5,
  concentration: true,
  saveAbility: 'wisdom',
  conditions: { onFailure: ['Paralyzed'] },
  turnEndSave: { ability: 'wisdom', removeConditionOnSuccess: true },
  school: 'enchantment',
  castingTime: 'action',
  range: 90,
  components: { v: true, s: true, m: 'a straight piece of iron' },
  classLists: ['Bard', 'Sorcerer', 'Warlock', 'Wizard'],
  description: 'A creature must succeed on a WIS save or be paralyzed. Works on any creature type (not limited to humanoids like Hold Person). Repeats save at end of each turn. +1 target per slot level above 5th.',
} as const satisfies CanonicalSpell;

export const WALL_OF_FORCE = {
  name: 'Wall of Force',
  level: 5,
  concentration: true,
  zone: {
    type: 'placed' as const,
    radiusFeet: 10, // Up to 10 panels, each 10x10 feet
    shape: 'circle' as const, // Can form a dome/sphere or flat panels
    effects: [
      {
        trigger: 'passive' as const,
        // Impassable barrier — nothing physical or magical passes through
        affectsEnemies: true,
        affectsAllies: true,
        affectsSelf: true,
      },
    ],
  },
  school: 'evocation',
  castingTime: 'action',
  range: 120,
  components: { v: true, s: true, m: 'a pinch of diamond dust' },
  classLists: ['Wizard'],
  description: 'An invisible wall of force. Nothing can physically pass through it. Immune to all damage. Only Disintegrate or Dispel Magic can remove it. Can form a dome (hemisphere of 10ft radius) or up to 10 flat panels.',
} as const satisfies CanonicalSpell;

export const ANIMATE_OBJECTS = {
  name: 'Animate Objects',
  level: 5,
  concentration: true,
  school: 'transmutation',
  castingTime: 'action',
  range: 120,
  components: { v: true, s: true },
  classLists: ['Bard', 'Sorcerer', 'Wizard'],
  description: 'Animate up to 10 Tiny nonmagical objects. Each can attack using your bonus action (Tiny: +8 to hit, 1d4+4 damage). +2 objects per slot level above 5th.',
} as const satisfies CanonicalSpell;

export const TELEKINESIS = {
  name: 'Telekinesis',
  level: 5,
  concentration: true,
  saveAbility: 'strength',
  school: 'transmutation',
  castingTime: 'action',
  range: 60,
  components: { v: true, s: true },
  classLists: ['Sorcerer', 'Wizard'],
  description: 'Move a creature or object up to 30 feet. Unwilling creature makes STR check contested by your spellcasting check. Can be used each round as an action for the duration.',
} as const satisfies CanonicalSpell;

export const CLOUDKILL = {
  name: 'Cloudkill',
  level: 5,
  concentration: true,
  saveAbility: 'constitution',
  halfDamageOnSave: true,
  zone: {
    type: 'placed' as const,
    radiusFeet: 20,
    shape: 'circle' as const,
    effects: [
      {
        trigger: 'on_start_turn' as const,
        damage: { diceCount: 5, diceSides: 8, modifier: 0 },
        damageType: 'poison',
        saveAbility: 'constitution',
        halfDamageOnSave: true,
        affectsEnemies: true,
        affectsAllies: true,
        affectsSelf: true,
      },
      {
        trigger: 'on_enter' as const,
        damage: { diceCount: 5, diceSides: 8, modifier: 0 },
        damageType: 'poison',
        saveAbility: 'constitution',
        halfDamageOnSave: true,
        affectsEnemies: true,
        affectsAllies: true,
        affectsSelf: true,
      },
    ],
  },
  upcastScaling: { additionalDice: { diceCount: 1, diceSides: 8 } },
  school: 'conjuration',
  castingTime: 'action',
  range: 120,
  components: { v: true, s: true },
  classLists: ['Sorcerer', 'Wizard'],
  description: 'A 20-foot-radius sphere of poisonous fog. 5d8 poison damage (CON save for half) on entering or starting turn. The cloud moves 10 feet away from you at the start of each of your turns.',
} as const satisfies CanonicalSpell;

export const RAISE_DEAD = {
  name: 'Raise Dead',
  level: 5,
  healing: { diceCount: 0, diceSides: 0, modifier: 1 },
  school: 'necromancy',
  castingTime: 'action',
  range: 'touch',
  components: {
    v: true, s: true,
    m: { description: 'a diamond worth 500+ GP, consumed', itemKeyword: 'diamond', costGp: 500, consumed: true },
  },
  classLists: ['Bard', 'Cleric', 'Druid', 'Paladin'],
  description: 'Touch a creature dead for no longer than 10 days. It revives with 1 HP and the Poisoned condition until it finishes a Long Rest.',
} as const satisfies CanonicalSpell;

export const LEVEL_5_CATALOG: readonly CanonicalSpell[] = [
  ANIMATE_OBJECTS,
  CLOUDKILL,
  CONE_OF_COLD,
  HOLD_MONSTER,
  RAISE_DEAD,
  TELEKINESIS,
  WALL_OF_FORCE,
];
