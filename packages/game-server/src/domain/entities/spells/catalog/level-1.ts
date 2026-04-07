/**
 * Canonical Level 1 Spell Catalog — D&D 5e 2024
 *
 * Each entry is the single source of truth for that spell's mechanics.
 * Effect values that depend on the caster (e.g., spellcasting modifier) use
 * placeholder 0 — consumers fill in the actual value at cast time.
 *
 * Layer: Domain (pure data, no side effects).
 */

import type { CanonicalSpell } from './types.js';

export const ABSORB_ELEMENTS = {
  name: 'Absorb Elements',
  level: 1,
  school: 'abjuration',
  castingTime: 'reaction',
  range: 'self',
  components: { s: true },
  classLists: ['Druid', 'Ranger', 'Sorcerer', 'Wizard'],
  description: 'Grants resistance to triggering elemental damage type and adds 1d6 of that type to your next melee attack.',
} as const satisfies CanonicalSpell;

export const BLESS = {
  name: 'Bless',
  level: 1,
  concentration: true,
  effects: [
    {
      type: 'bonus' as const,
      target: 'attack_rolls' as const,
      diceValue: { count: 1, sides: 4 },
      duration: 'concentration' as const,
      appliesTo: 'self' as const,
    },
    {
      type: 'bonus' as const,
      target: 'saving_throws' as const,
      diceValue: { count: 1, sides: 4 },
      duration: 'concentration' as const,
      appliesTo: 'self' as const,
    },
  ],
  school: 'enchantment',
  castingTime: 'action',
  range: 30,
  components: { v: true, s: true, m: 'a Holy Symbol worth 5+ GP' },
  classLists: ['Cleric', 'Paladin'],
  description: 'Bless up to three creatures, adding 1d4 to attack rolls and saving throws. +1 target per slot level above 1st.',
} as const satisfies CanonicalSpell;

export const BURNING_HANDS = {
  name: 'Burning Hands',
  level: 1,
  saveAbility: 'dexterity',
  damage: { diceCount: 3, diceSides: 6, modifier: 0 },
  damageType: 'fire',
  halfDamageOnSave: true,
  area: { type: 'cone' as const, size: 15 },
  upcastScaling: { additionalDice: { diceCount: 1, diceSides: 6 } },
  school: 'evocation',
  castingTime: 'action',
  range: 'self',
  components: { v: true, s: true },
  classLists: ['Sorcerer', 'Wizard'],
  description: 'A thin sheet of flames shoots forth in a 15-foot cone.',
} as const satisfies CanonicalSpell;

export const CAUSE_FEAR = {
  name: 'Cause Fear',
  level: 1,
  concentration: true,
  saveAbility: 'wisdom',
  damage: { diceCount: 0, diceSides: 0, modifier: 0 },
  damageType: 'psychic',
  halfDamageOnSave: false,
  conditions: { onFailure: ['Frightened'] },
  turnEndSave: { ability: 'wisdom', removeConditionOnSuccess: true },
  school: 'necromancy',
  castingTime: 'action',
  range: 60,
  components: { v: true },
  classLists: ['Warlock', 'Wizard'],
  description: 'A creature must succeed on a WIS save or become frightened for the duration.',
} as const satisfies CanonicalSpell;

export const CURE_WOUNDS = {
  name: 'Cure Wounds',
  level: 1,
  healing: { diceCount: 2, diceSides: 8 },
  upcastScaling: { additionalDice: { diceCount: 2, diceSides: 8 } },
  school: 'abjuration',
  castingTime: 'action',
  range: 'touch',
  components: { v: true, s: true },
  classLists: ['Bard', 'Cleric', 'Druid', 'Paladin', 'Ranger'],
  description: 'A creature you touch regains 2d8 + spellcasting modifier HP.',
} as const satisfies CanonicalSpell;

export const GUIDING_BOLT = {
  name: 'Guiding Bolt',
  level: 1,
  attackType: 'ranged_spell',
  damage: { diceCount: 4, diceSides: 6 },
  damageType: 'radiant',
  upcastScaling: { additionalDice: { diceCount: 1, diceSides: 6 } },
  school: 'evocation',
  castingTime: 'action',
  range: 120,
  components: { v: true, s: true },
  classLists: ['Cleric'],
  description: 'A bolt of light that deals radiant damage. Next attack against the target has advantage.',
} as const satisfies CanonicalSpell;

export const HEALING_WORD = {
  name: 'Healing Word',
  level: 1,
  healing: { diceCount: 2, diceSides: 4 },
  isBonusAction: true,
  upcastScaling: { additionalDice: { diceCount: 2, diceSides: 4 } },
  school: 'abjuration',
  castingTime: 'bonus_action',
  range: 60,
  components: { v: true },
  classLists: ['Bard', 'Cleric', 'Druid'],
  description: 'A creature you can see regains 2d4 + spellcasting modifier HP.',
} as const satisfies CanonicalSpell;

export const HELLISH_REBUKE = {
  name: 'Hellish Rebuke',
  level: 1,
  saveAbility: 'dexterity',
  damage: { diceCount: 2, diceSides: 10 },
  damageType: 'fire',
  halfDamageOnSave: true,
  upcastScaling: { additionalDice: { diceCount: 1, diceSides: 10 } },
  school: 'evocation',
  castingTime: 'reaction',
  range: 60,
  components: { v: true, s: true },
  classLists: ['Warlock'],
  description: 'The creature that damaged you is surrounded by flames, making a DEX save.',
} as const satisfies CanonicalSpell;

export const HEROISM = {
  name: 'Heroism',
  level: 1,
  concentration: true,
  effects: [
    {
      type: 'recurring_temp_hp' as const,
      target: 'hit_points' as const,
      value: 0, // Placeholder — actual value is caster's spellcasting ability modifier
      duration: 'concentration' as const,
      triggerAt: 'start_of_turn' as const,
      appliesTo: 'self' as const,
    },
    {
      type: 'condition_immunity' as const,
      target: 'custom' as const,
      conditionName: 'Frightened',
      duration: 'concentration' as const,
      appliesTo: 'self' as const,
    },
  ],
  school: 'enchantment',
  castingTime: 'action',
  range: 'touch',
  components: { v: true, s: true },
  classLists: ['Bard', 'Paladin'],
  description: 'Target is immune to Frightened and gains temp HP equal to your spellcasting modifier each turn.',
} as const satisfies CanonicalSpell;

export const INFLICT_WOUNDS = {
  name: 'Inflict Wounds',
  level: 1,
  attackType: 'melee_spell',
  damage: { diceCount: 3, diceSides: 10 },
  damageType: 'necrotic',
  upcastScaling: { additionalDice: { diceCount: 1, diceSides: 10 } },
  school: 'necromancy',
  castingTime: 'action',
  range: 'touch',
  components: { v: true, s: true },
  classLists: ['Cleric'],
  description: 'Make a melee spell attack against a creature you can touch. On a hit, the target takes 3d10 necrotic damage.',
} as const satisfies CanonicalSpell;

export const LONGSTRIDER = {
  name: 'Longstrider',
  level: 1,
  effects: [
    {
      type: 'speed_modifier' as const,
      target: 'speed' as const,
      value: 10,
      duration: 'rounds' as const,
      roundsRemaining: 600, // ~1 hour at 6-second rounds
      appliesTo: 'self' as const,
    },
  ],
  school: 'transmutation',
  castingTime: 'action',
  range: 'touch',
  components: { v: true, s: true, m: 'a pinch of dirt' },
  classLists: ['Bard', 'Druid', 'Ranger', 'Wizard'],
  description: 'Target\'s speed increases by 10 feet for 1 hour. +1 target per slot level above 1st.',
} as const satisfies CanonicalSpell;

export const MAGE_ARMOR = {
  name: 'Mage Armor',
  level: 1,
  effects: [
    {
      type: 'custom' as const,
      target: 'armor_class' as const,
      value: 13, // Base AC override: 13 + DEX modifier (not a bonus — replaces base AC calculation)
      duration: 'rounds' as const,
      roundsRemaining: 4800, // ~8 hours at 6-second rounds
      appliesTo: 'target' as const,
    },
  ],
  school: 'abjuration',
  castingTime: 'action',
  range: 'touch',
  components: { v: true, s: true, m: 'a piece of cured leather' },
  classLists: ['Sorcerer', 'Wizard'],
  description: 'Target\'s base AC becomes 13 + Dexterity modifier for 8 hours. Ends if target dons armor.',
} as const satisfies CanonicalSpell;

export const MAGIC_MISSILE = {
  name: 'Magic Missile',
  level: 1,
  damage: { diceCount: 1, diceSides: 4, modifier: 1 },
  damageType: 'force',
  // Phase 4: add autoHit: true — Magic Missile always hits (no attack roll needed)
  // Phase 4: add dartCount: 3 — three darts at base level, +1 per upcast level
  upcastScaling: { additionalDice: { diceCount: 1, diceSides: 4 } },
  school: 'evocation',
  castingTime: 'action',
  range: 120,
  components: { v: true, s: true },
  classLists: ['Sorcerer', 'Wizard'],
  description: 'Three glowing darts of force that automatically hit. +1 dart per slot level above 1st.',
} as const satisfies CanonicalSpell;

export const SHIELD_SPELL = {
  name: 'Shield',
  level: 1,
  school: 'abjuration',
  castingTime: 'reaction',
  range: 'self',
  components: { v: true, s: true },
  classLists: ['Sorcerer', 'Wizard'],
  description: '+5 AC until start of your next turn, including against the triggering attack. Blocks Magic Missile.',
} as const satisfies CanonicalSpell;

export const SHIELD_OF_FAITH = {
  name: 'Shield of Faith',
  level: 1,
  concentration: true,
  isBonusAction: true,
  effects: [
    {
      type: 'bonus' as const,
      target: 'armor_class' as const,
      value: 2,
      duration: 'concentration' as const,
      appliesTo: 'self' as const,
    },
  ],
  school: 'abjuration',
  castingTime: 'bonus_action',
  range: 60,
  components: { v: true, s: true, m: 'a prayer scroll' },
  classLists: ['Cleric', 'Paladin'],
  description: 'A shimmering field grants +2 AC to a creature for the duration.',
} as const satisfies CanonicalSpell;

export const THUNDERWAVE = {
  name: 'Thunderwave',
  level: 1,
  saveAbility: 'constitution',
  damage: { diceCount: 2, diceSides: 8 },
  damageType: 'thunder',
  halfDamageOnSave: true,
  area: { type: 'cube' as const, size: 15 },
  upcastScaling: { additionalDice: { diceCount: 1, diceSides: 8 } },
  school: 'evocation',
  castingTime: 'action',
  range: 'self',
  components: { v: true, s: true },
  classLists: ['Bard', 'Druid', 'Sorcerer', 'Wizard'],
  description: 'A wave of thunderous force. Failed save: full damage + pushed 10 ft. Success: half damage only.',
} as const satisfies CanonicalSpell;

export const THUNDEROUS_WARD = {
  name: 'Thunderous Ward',
  level: 1,
  effects: [
    {
      type: 'ongoing_damage' as const,
      target: 'hit_points' as const,
      diceValue: { count: 2, sides: 8 },
      damageType: 'thunder',
      duration: 'until_end_of_next_turn' as const,
      triggerAt: 'on_voluntary_move' as const,
      appliesTo: 'target' as const,
    },
  ],
  school: 'abjuration',
  castingTime: 'action',
  range: 'touch',
  components: { v: true, s: true },
  classLists: ['Cleric'],
  description: 'Wraps target in thunderous energy. If target moves voluntarily, it takes 2d8 thunder damage.',
} as const satisfies CanonicalSpell;

export const LEVEL_1_CATALOG: readonly CanonicalSpell[] = [
  ABSORB_ELEMENTS,
  BLESS,
  BURNING_HANDS,
  CAUSE_FEAR,
  CURE_WOUNDS,
  GUIDING_BOLT,
  HEALING_WORD,
  HELLISH_REBUKE,
  HEROISM,
  INFLICT_WOUNDS,
  LONGSTRIDER,
  MAGE_ARMOR,
  MAGIC_MISSILE,
  SHIELD_SPELL,
  SHIELD_OF_FAITH,
  THUNDERWAVE,
  THUNDEROUS_WARD,
];
