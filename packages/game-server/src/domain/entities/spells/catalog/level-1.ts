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
  effects: [
    {
      type: 'resistance' as const,
      target: 'hit_points' as const,
      // Damage type is resolved at cast time from the triggering damage
      damageType: 'triggering',
      duration: 'until_start_of_next_turn' as const,
      appliesTo: 'self' as const,
    },
    {
      type: 'bonus' as const,
      target: 'melee_damage_rolls' as const,
      diceValue: { count: 1, sides: 6 },
      // Damage type matches the triggering element, resolved at cast time
      damageType: 'triggering',
      duration: 'until_triggered' as const,
      appliesTo: 'self' as const,
    },
  ],
  upcastScaling: { additionalDice: { diceCount: 1, diceSides: 6 } },
  school: 'abjuration',
  castingTime: 'reaction',
  range: 'self',
  components: { s: true },
  classLists: ['Druid', 'Ranger', 'Sorcerer', 'Wizard'],
  description: 'Grants resistance to triggering elemental damage type until start of your next turn and adds 1d6 of that type to your next melee attack. +1d6 per slot level above 1st.',
} as const satisfies CanonicalSpell;

export const BANE = {
  name: 'Bane',
  level: 1,
  concentration: true,
  saveAbility: 'charisma',
  // Effects apply only on failed CHA save (handled by BuffDebuffSpellDeliveryHandler
  // when `saveAbility` is set and there is no `damage`/`conditions.onFailure`).
  effects: [
    {
      type: 'penalty' as const,
      target: 'attack_rolls' as const,
      diceValue: { count: 1, sides: 4 },
      duration: 'concentration' as const,
      appliesTo: 'target' as const,
    },
    {
      type: 'penalty' as const,
      target: 'saving_throws' as const,
      diceValue: { count: 1, sides: 4 },
      duration: 'concentration' as const,
      appliesTo: 'target' as const,
    },
  ],
  school: 'enchantment',
  castingTime: 'action',
  range: 30,
  components: { v: true, s: true, m: 'a drop of blood' },
  classLists: ['Bard', 'Cleric'],
  description:
    'Up to three creatures of your choice make a CHA save. On a failed save, target subtracts 1d4 from attack rolls and saving throws for the duration (up to 1 minute, concentration). +1 target per slot level above 1st.',
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
      appliesTo: 'allies' as const,
    },
    {
      type: 'bonus' as const,
      target: 'saving_throws' as const,
      diceValue: { count: 1, sides: 4 },
      duration: 'concentration' as const,
      appliesTo: 'allies' as const,
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

export const DETECT_MAGIC = {
  name: 'Detect Magic',
  level: 1,
  concentration: true,
  ritual: true,
  school: 'divination',
  castingTime: 'action',
  range: 'self',
  components: { v: true, s: true },
  classLists: ['Bard', 'Cleric', 'Druid', 'Paladin', 'Ranger', 'Sorcerer', 'Wizard'],
  description: 'For the duration, you sense the presence of magic within 30 feet. Can be cast as a ritual.',
} as const satisfies CanonicalSpell;

export const GUIDING_BOLT = {
  name: 'Guiding Bolt',
  level: 1,
  attackType: 'ranged_spell',
  damage: { diceCount: 4, diceSides: 6 },
  damageType: 'radiant',
  effects: [
    {
      type: 'advantage' as const,
      target: 'next_attack' as const,
      duration: 'until_triggered' as const,
      appliesTo: 'target' as const,
    },
  ],
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
      value: 0, // Placeholder — resolved from caster's spellcasting ability modifier at cast time
      valueSource: 'spellcastingModifier' as const,
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
  autoHit: true,
  dartCount: 3,
  // No upcastScaling — Magic Missile upcasting adds +1 dart per slot level above 1st,
  // not additional dice. Dart scaling is handled by the auto-hit delivery path:
  //   dartCount + (castAtLevel - spell.level)
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
  effects: [
    {
      type: 'bonus' as const,
      target: 'armor_class' as const,
      value: 5,
      duration: 'until_start_of_next_turn' as const,
      appliesTo: 'self' as const,
    },
  ],
  school: 'abjuration',
  castingTime: 'reaction',
  range: 'self',
  components: { v: true, s: true },
  classLists: ['Sorcerer', 'Wizard'],
  description: '+5 AC until start of your next turn, including against the triggering attack. Blocks Magic Missile.',
} as const satisfies CanonicalSpell;

export const SILVERY_BARBS = {
  name: 'Silvery Barbs',
  level: 1,
  effects: [
    {
      type: 'disadvantage' as const,
      target: 'custom' as const,
      // Forces the triggering creature to reroll and use the lower result
      duration: 'instant' as const,
      appliesTo: 'target' as const,
    },
    {
      type: 'advantage' as const,
      target: 'next_attack' as const,
      // Grants advantage on the next d20 roll to an ally of your choice
      duration: 'until_triggered' as const,
      appliesTo: 'allies' as const,
    },
  ],
  school: 'enchantment',
  castingTime: 'reaction',
  range: 60,
  components: { v: true },
  classLists: ['Bard', 'Sorcerer', 'Wizard'],
  description: 'When a creature within 60 feet succeeds on an attack roll, ability check, or saving throw, force a reroll and use the lower result. Grant one creature of your choice advantage on the next d20 roll within 1 minute.',
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
  pushOnFailFeet: 10,
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
  range: 30,
  components: { v: true, s: true },
  classLists: ['Cleric'],
  description: 'Wraps target in thunderous energy. If target moves voluntarily, it takes 2d8 thunder damage.',
} as const satisfies CanonicalSpell;

export const COMMAND = {
  name: 'Command',
  level: 1,
  saveAbility: 'wisdom',
  halfDamageOnSave: false,
  conditions: { onFailure: ['Incapacitated'] },
  // On failed save, target obeys a one-word command on its next turn.
  // Approximated as Incapacitated for one turn (cannot take actions).
  turnEndSave: { ability: 'wisdom', removeConditionOnSuccess: true },
  school: 'enchantment',
  castingTime: 'action',
  range: 60,
  components: { v: true },
  classLists: ['Bard', 'Cleric', 'Paladin'],
  description: 'Speak a one-word command to a creature. On failed WIS save, target follows the command on its next turn. +1 target per slot level above 1st.',
} as const satisfies CanonicalSpell;

export const FAERIE_FIRE = {
  name: 'Faerie Fire',
  level: 1,
  concentration: true,
  saveAbility: 'dexterity',
  halfDamageOnSave: false,
  area: { type: 'cube' as const, size: 20 },
  effects: [
    {
      type: 'advantage' as const,
      target: 'attack_rolls' as const,
      duration: 'concentration' as const,
      appliesTo: 'target' as const,
    },
  ],
  // On failed save: outlined in light, attacks have advantage, can't benefit from Invisible
  school: 'evocation',
  castingTime: 'action',
  range: 60,
  components: { v: true },
  classLists: ['Bard', 'Druid'],
  description: 'Creatures in a 20-foot cube make DEX save. On fail: outlined in light, attack rolls against them have advantage, cannot benefit from Invisible.',
} as const satisfies CanonicalSpell;

export const HEX = {
  name: 'Hex',
  level: 1,
  concentration: true,
  isBonusAction: true,
  effects: [
    {
      type: 'bonus' as const,
      target: 'damage_rolls' as const,
      diceValue: { count: 1, sides: 6 },
      damageType: 'necrotic',
      duration: 'concentration' as const,
      appliesTo: 'target' as const,
    },
    {
      type: 'disadvantage' as const,
      target: 'ability_checks' as const,
      duration: 'concentration' as const,
      appliesTo: 'target' as const,
    },
  ],
  school: 'enchantment',
  castingTime: 'bonus_action',
  range: 90,
  components: { v: true, s: true, m: 'the petrified eye of a newt' },
  classLists: ['Warlock'],
  description: 'Bonus action. Target takes extra 1d6 necrotic on your attacks and has disadvantage on one ability check type you choose.',
} as const satisfies CanonicalSpell;

export const HUNTERS_MARK = {
  name: "Hunter's Mark",
  level: 1,
  concentration: true,
  isBonusAction: true,
  effects: [
    {
      type: 'bonus' as const,
      target: 'damage_rolls' as const,
      diceValue: { count: 1, sides: 6 },
      damageType: 'force',
      duration: 'concentration' as const,
      appliesTo: 'target' as const,
    },
  ],
  school: 'divination',
  castingTime: 'bonus_action',
  range: 90,
  components: { v: true },
  classLists: ['Ranger'],
  description: "Bonus action. Mark a creature. Your weapon attacks deal extra 1d6 force damage to the target. Can move the mark as bonus action when the target drops to 0 HP.",
} as const satisfies CanonicalSpell;

export const SLEEP = {
  name: 'Sleep',
  level: 1,
  concentration: true,
  // D&D 5e 2024: Sleep is concentration, WIS save, puts creatures to sleep
  saveAbility: 'wisdom',
  halfDamageOnSave: false,
  conditions: { onFailure: ['Unconscious'] },
  area: { type: 'sphere' as const, size: 20 },
  school: 'enchantment',
  castingTime: 'action',
  range: 60,
  components: { v: true, s: true, m: 'a pinch of sand' },
  classLists: ['Bard', 'Sorcerer', 'Wizard'],
  description: 'Creatures in a 20-foot-radius sphere make WIS save or fall Unconscious. The spell ends for a creature if it takes damage or someone uses an action to wake it.',
} as const satisfies CanonicalSpell;

export const LEVEL_1_CATALOG: readonly CanonicalSpell[] = [
  ABSORB_ELEMENTS,
  BANE,
  BLESS,
  BURNING_HANDS,
  CAUSE_FEAR,
  COMMAND,
  CURE_WOUNDS,
  DETECT_MAGIC,
  FAERIE_FIRE,
  GUIDING_BOLT,
  HEALING_WORD,
  HELLISH_REBUKE,
  HEROISM,
  HEX,
  HUNTERS_MARK,
  INFLICT_WOUNDS,
  LONGSTRIDER,
  MAGE_ARMOR,
  MAGIC_MISSILE,
  SHIELD_SPELL,
  SHIELD_OF_FAITH,
  SILVERY_BARBS,
  SLEEP,
  THUNDERWAVE,
  THUNDEROUS_WARD,
];
