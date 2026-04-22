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
      {
        trigger: 'on_enter' as const,
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
  turnEndSave: { ability: 'wisdom', removeConditionOnSuccess: true },
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
  effects: [
    {
      type: 'custom' as const,
      target: 'custom' as const,
      value: 30, // Teleport distance in feet
      duration: 'instant' as const,
      appliesTo: 'self' as const,
    },
  ],
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
      {
        trigger: 'on_enter' as const,
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
  multiAttack: { baseCount: 3, scaling: 'perLevel' },
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
  // D&D 5e 2024: Spiritual Weapon does NOT require concentration
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
  // TODO: Subsequent turns allow bonus action to move weapon 20ft + repeat melee spell attack
  description: 'A floating spectral weapon that attacks for 1d8 + spellcasting modifier force damage. Move and repeat as bonus action.',
} as const satisfies CanonicalSpell;

export const AID = {
  name: 'Aid',
  level: 2,
  // D&D 5e 2024: Aid is NOT concentration. Increases max HP by 5 per slot level for 3 creatures.
  effects: [
    {
      type: 'custom' as const,
      target: 'hit_points' as const,
      value: 5, // Base: +5 max HP, scales +5 per upcast level
      duration: 'rounds' as const,
      roundsRemaining: 4800, // ~8 hours at 6s rounds
      appliesTo: 'target' as const,
    },
  ],
  upcastScaling: { additionalDice: { diceCount: 0, diceSides: 0 } },
  // Custom upcast: +5 max HP per level above 2nd (not dice-based; delivery handler interprets)
  school: 'abjuration',
  castingTime: 'action',
  range: 30,
  components: { v: true, s: true, m: 'a strip of white cloth' },
  classLists: ['Bard', 'Cleric', 'Druid', 'Paladin', 'Ranger'],
  description: 'Up to 3 creatures gain 5 extra max HP (and current HP) for 8 hours. +5 per slot level above 2nd.',
} as const satisfies CanonicalSpell;

export const DARKNESS = {
  name: 'Darkness',
  level: 2,
  concentration: true,
  zone: {
    type: 'placed' as const,
    radiusFeet: 15,
    shape: 'circle' as const,
    effects: [
      {
        trigger: 'passive' as const,
        conditions: ['Blinded'],
        affectsEnemies: true,
        affectsAllies: true,
        affectsSelf: true,
      },
    ],
  },
  school: 'evocation',
  castingTime: 'action',
  range: 60,
  components: { v: true, m: 'bat fur and a piece of coal' },
  classLists: ['Sorcerer', 'Warlock', 'Wizard'],
  description: 'Magical darkness fills a 15-foot-radius sphere. Creatures inside are heavily obscured (effectively Blinded). Nonmagical light cannot illuminate it.',
} as const satisfies CanonicalSpell;

export const INVISIBILITY = {
  name: 'Invisibility',
  level: 2,
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
  components: { v: true, s: true, m: 'an eyelash in gum arabic' },
  classLists: ['Bard', 'Sorcerer', 'Warlock', 'Wizard'],
  description: 'Target becomes Invisible until the spell ends. Ends if target attacks or casts a spell. +1 target per slot level above 2nd.',
} as const satisfies CanonicalSpell;

export const LESSER_RESTORATION = {
  name: 'Lesser Restoration',
  level: 2,
  // Ends one condition: Blinded, Deafened, Paralyzed, or Poisoned
  effects: [
    {
      type: 'custom' as const,
      target: 'custom' as const,
      duration: 'instant' as const,
      appliesTo: 'target' as const,
      triggerConditions: ['Blinded', 'Deafened', 'Paralyzed', 'Poisoned'],
    },
  ],
  school: 'abjuration',
  castingTime: 'action',
  range: 'touch',
  components: { v: true, s: true },
  classLists: ['Bard', 'Cleric', 'Druid', 'Paladin', 'Ranger'],
  description: 'End one condition on a creature you touch: Blinded, Deafened, Paralyzed, or Poisoned.',
} as const satisfies CanonicalSpell;

export const WEB = {
  name: 'Web',
  level: 2,
  concentration: true,
  zone: {
    type: 'placed' as const,
    radiusFeet: 20,
    shape: 'cube' as const,
    effects: [
      {
        trigger: 'on_start_turn' as const,
        saveAbility: 'dexterity',
        conditions: ['Restrained'],
        affectsEnemies: true,
        affectsAllies: true,
        affectsSelf: true,
      },
    ],
  },
  school: 'conjuration',
  castingTime: 'action',
  range: 60,
  components: { v: true, s: true, m: 'a bit of spiderweb' },
  classLists: ['Sorcerer', 'Wizard'],
  description: 'Thick webs fill a 20-foot cube. DEX save or Restrained. Restrained creatures can repeat save at end of each turn.',
} as const satisfies CanonicalSpell;

// ── Additional L2 spells (2024 RAW) ──

export const BRANDING_SMITE = {
  name: 'Branding Smite',
  level: 2,
  concentration: true,
  isBonusAction: true,
  effects: [
    {
      type: 'bonus' as const,
      target: 'damage_rolls' as const,
      diceValue: { count: 2, sides: 6 },
      damageType: 'radiant',
      duration: 'concentration' as const,
      triggerAt: 'on_next_weapon_hit' as const,
      appliesTo: 'self' as const,
    },
  ],
  upcastScaling: { additionalDice: { diceCount: 1, diceSides: 6 } },
  school: 'evocation',
  castingTime: 'bonus_action',
  range: 'self',
  components: { v: true },
  classLists: ['Paladin'],
  description: 'The next time you hit a target with a weapon this turn, the attack deals +2d6 radiant damage and sheds bright light in a 5-foot radius from the target.',
} as const satisfies CanonicalSpell;

export const PASS_WITHOUT_TRACE = {
  name: 'Pass Without Trace',
  level: 2,
  concentration: true,
  // Aura: allies within 30 ft gain +10 to Stealth checks. Modelled as a bonus on ability_checks
  // scoped to the caster and propagated to allies by the delivery handler (appliesTo: allies).
  effects: [
    {
      type: 'bonus' as const,
      target: 'ability_checks' as const,
      value: 10,
      duration: 'concentration' as const,
      appliesTo: 'allies' as const,
    },
  ],
  school: 'abjuration',
  castingTime: 'action',
  range: 'self',
  components: { v: true, s: true, m: 'ashes from a burned mistletoe leaf' },
  classLists: ['Druid', 'Ranger'],
  description: 'A veil of shadows. You and creatures of your choice within 30 feet get +10 to Dexterity (Stealth) checks for the duration.',
} as const satisfies CanonicalSpell;

export const MIRROR_IMAGE = {
  name: 'Mirror Image',
  level: 2,
  // 2024 RAW: not concentration. Three illusory duplicates.
  effects: [
    {
      type: 'custom' as const,
      target: 'custom' as const,
      value: 3, // Number of duplicates
      duration: 'rounds' as const,
      roundsRemaining: 10,
      appliesTo: 'self' as const,
      conditionName: 'MirrorImage',
    },
  ],
  school: 'illusion',
  castingTime: 'action',
  range: 'self',
  components: { v: true, s: true },
  classLists: ['Bard', 'Sorcerer', 'Warlock', 'Wizard'],
  description: 'Three illusory duplicates appear near you. Each time a creature attacks you during the spell, a duplicate may be destroyed in your place (AC = 10 + DEX mod).',
} as const satisfies CanonicalSpell;

export const BLINDNESS_DEAFNESS = {
  name: 'Blindness/Deafness',
  level: 2,
  saveAbility: 'constitution',
  halfDamageOnSave: false,
  conditions: { onFailure: ['Blinded'] },
  turnEndSave: { ability: 'constitution', removeConditionOnSuccess: true },
  school: 'necromancy',
  castingTime: 'action',
  range: 30,
  components: { v: true },
  classLists: ['Bard', 'Cleric', 'Sorcerer', 'Wizard'],
  description: 'Target makes a CON save or becomes Blinded (or Deafened) for 1 minute. Target repeats the save at the end of each of its turns.',
} as const satisfies CanonicalSpell;

export const SUGGESTION = {
  name: 'Suggestion',
  level: 2,
  concentration: true,
  saveAbility: 'wisdom',
  conditions: { onFailure: ['Charmed'] },
  // 2024 RAW is 8-hour social effect; in combat, simplified: Charmed until spell ends (concentration) or until damaged.
  turnEndSave: { ability: 'wisdom', removeConditionOnSuccess: true },
  school: 'enchantment',
  castingTime: 'action',
  range: 30,
  components: { v: true, m: 'a snake\'s tongue and a bit of honeycomb' },
  classLists: ['Bard', 'Sorcerer', 'Warlock', 'Wizard'],
  description: 'Suggest a reasonable course of action to a creature. WIS save or Charmed and follow the suggestion. Ends if target is damaged or concentration drops.',
} as const satisfies CanonicalSpell;

export const ZONE_OF_TRUTH = {
  name: 'Zone of Truth',
  level: 2,
  saveAbility: 'charisma',
  school: 'enchantment',
  castingTime: 'action',
  range: 60,
  components: { v: true, s: true },
  classLists: ['Bard', 'Cleric', 'Paladin'],
  description: 'Creatures in a 15-foot-radius sphere cannot speak deliberate lies. CHA save to detect the zone (not its effect).',
} as const satisfies CanonicalSpell;

export const LEVEL_2_CATALOG: readonly CanonicalSpell[] = [
  AID,
  BLINDNESS_DEAFNESS,
  BRANDING_SMITE,
  CLOUD_OF_DAGGERS,
  DARKNESS,
  HOLD_PERSON,
  INVISIBILITY,
  LESSER_RESTORATION,
  MIRROR_IMAGE,
  MISTY_STEP,
  MOONBEAM,
  PASS_WITHOUT_TRACE,
  SCORCHING_RAY,
  SHATTER,
  SPIKE_GROWTH,
  SPIRITUAL_WEAPON,
  SUGGESTION,
  WEB,
  ZONE_OF_TRUTH,
];
