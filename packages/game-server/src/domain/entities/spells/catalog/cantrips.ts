/**
 * Canonical Cantrip Catalog — D&D 5e 2024
 *
 * Each entry is the single source of truth for that cantrip's mechanics.
 * Cantrip damage scales via getCantripDamageDice() — these define base (level 1) dice.
 *
 * Layer: Domain (pure data, no side effects).
 */

import type { CanonicalSpell } from './types.js';

export const ELDRITCH_BLAST = {
  name: 'Eldritch Blast',
  level: 0,
  attackType: 'ranged_spell',
  damage: { diceCount: 1, diceSides: 10 },
  damageType: 'force',
  // No upcastScaling — cantrip scaling creates extra beams at levels 5/11/17,
  // not extra dice per beam. Beam count handled by cantrip-specific logic.
  school: 'evocation',
  castingTime: 'action',
  range: 120,
  components: { v: true, s: true },
  classLists: ['Warlock'],
  description: 'A beam of crackling energy. Creates additional beams at levels 5, 11, and 17.',
} as const satisfies CanonicalSpell;

export const FIRE_BOLT = {
  name: 'Fire Bolt',
  level: 0,
  attackType: 'ranged_spell',
  damage: { diceCount: 1, diceSides: 10, modifier: 0 },
  damageType: 'fire',
  school: 'evocation',
  castingTime: 'action',
  range: 120,
  components: { v: true, s: true },
  classLists: ['Sorcerer', 'Wizard'],
  description: 'A mote of fire hurled at a creature or object within range.',
} as const satisfies CanonicalSpell;

export const PRODUCE_FLAME = {
  name: 'Produce Flame',
  level: 0,
  attackType: 'ranged_spell',
  damage: { diceCount: 1, diceSides: 8, modifier: 0 },
  damageType: 'fire',
  school: 'conjuration',
  castingTime: 'action',
  range: 'self',
  components: { v: true, s: true },
  classLists: ['Druid'],
  description: 'A flickering flame you can hurl at a creature within 60 feet.',
} as const satisfies CanonicalSpell;

export const SACRED_FLAME = {
  name: 'Sacred Flame',
  level: 0,
  saveAbility: 'dexterity',
  damage: { diceCount: 1, diceSides: 8, modifier: 0 },
  damageType: 'radiant',
  halfDamageOnSave: false,
  school: 'evocation',
  castingTime: 'action',
  range: 60,
  components: { v: true, s: true },
  classLists: ['Cleric'],
  description: 'Flame-like radiance descends on a creature. Target gains no benefit from cover for this save.',
} as const satisfies CanonicalSpell;

export const RAY_OF_FROST = {
  name: 'Ray of Frost',
  level: 0,
  attackType: 'ranged_spell',
  damage: { diceCount: 1, diceSides: 8 },
  damageType: 'cold',
  school: 'evocation',
  castingTime: 'action',
  range: 60,
  components: { v: true, s: true },
  classLists: ['Sorcerer', 'Wizard'],
  description: 'A frigid beam that deals cold damage and reduces target speed by 10 feet until start of your next turn.',
} as const satisfies CanonicalSpell;

export const TOLL_THE_DEAD = {
  name: 'Toll the Dead',
  level: 0,
  saveAbility: 'wisdom',
  damage: { diceCount: 1, diceSides: 8 },
  damageType: 'necrotic',
  halfDamageOnSave: false,
  school: 'necromancy',
  castingTime: 'action',
  range: 60,
  components: { v: true, s: true },
  classLists: ['Cleric', 'Wizard'],
  description: 'The sound of a dolorous bell. Deals 1d12 instead of 1d8 if the target is already damaged.',
} as const satisfies CanonicalSpell;

export const CHILL_TOUCH = {
  name: 'Chill Touch',
  level: 0,
  attackType: 'melee_spell',
  damage: { diceCount: 1, diceSides: 10 },
  damageType: 'necrotic',
  school: 'necromancy',
  castingTime: 'action',
  range: 'touch',
  components: { v: true, s: true },
  classLists: ['Sorcerer', 'Warlock', 'Wizard'],
  description: 'Channeling the chill of the grave. Target cannot regain HP until end of your next turn.',
} as const satisfies CanonicalSpell;

export const BOOMING_BLADE = {
  name: 'Booming Blade',
  level: 0,
  attackType: 'melee_spell',
  school: 'evocation',
  castingTime: 'action',
  range: 'self',
  components: { v: true, s: true, m: 'a melee weapon worth at least 1 SP' },
  classLists: ['Sorcerer', 'Warlock', 'Wizard'],
  description: 'Make a melee attack that wraps the target in booming energy. If the target voluntarily moves, it takes thunder damage.',
} as const satisfies CanonicalSpell;

export const CANTRIP_CATALOG: readonly CanonicalSpell[] = [
  ELDRITCH_BLAST,
  FIRE_BOLT,
  PRODUCE_FLAME,
  SACRED_FLAME,
  RAY_OF_FROST,
  TOLL_THE_DEAD,
  CHILL_TOUCH,
  BOOMING_BLADE,
];
