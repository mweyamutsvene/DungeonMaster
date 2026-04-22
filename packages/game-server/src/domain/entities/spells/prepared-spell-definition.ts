/**
 * PreparedSpellDefinition — domain interface for a spell on a character's prepared list.
 *
 * This captures the shape of entries in `character.sheet.preparedSpells[]`.
 * It is the source of truth for what data the spell action handler expects.
 */

import type { EffectType, EffectTarget, EffectDuration } from '../combat/effects.js';
import type { ZoneType, ZoneShape, ZoneEffectTrigger } from '../combat/zones.js';
import type { AreaOfEffect } from '../../rules/area-of-effect.js';

/** Dice expression: NdS+M */
export interface SpellDice {
  readonly diceCount: number;
  readonly diceSides: number;
  readonly modifier?: number;
}

/**
 * Upcast scaling declaration for a prepared spell.
 * Defines the additional dice gained per slot level above the spell's base level.
 *
 * Example: Burning Hands (base level 1) gains +1d6 per level above 1st:
 *   `{ additionalDice: { diceCount: 1, diceSides: 6 } }`
 */
export interface UpcastScaling {
  readonly additionalDice: SpellDice;
}

/** Effect declaration attached to a buff/debuff spell. */
export interface SpellEffectDeclaration {
  readonly type: EffectType;
  readonly target: EffectTarget;
  readonly value?: number;
  /** When set, the delivery handler resolves `value` dynamically at cast time instead of using the literal. */
  readonly valueSource?: 'spellcastingModifier';
  readonly diceValue?: { count: number; sides: number };
  readonly damageType?: string;
  /** When present, limits the effect to a specific ability (e.g. Haste grants advantage on DEX saves only). */
  readonly ability?: string;
  readonly duration: EffectDuration;
  readonly roundsRemaining?: number;
  readonly triggerAt?: 'start_of_turn' | 'end_of_turn' | 'on_voluntary_move' | 'on_next_weapon_hit';
  readonly saveToEnd?: { ability: string; dc: number };
  readonly conditionName?: string;
  readonly triggerSave?: { ability: string; dc: number; halfDamageOnSave?: boolean };
  readonly triggerConditions?: string[];
  readonly appliesTo?: 'self' | 'target' | 'allies' | 'enemies';
}

/** Single mechanical effect within a zone. */
export interface SpellZoneEffectDeclaration {
  readonly trigger: ZoneEffectTrigger;
  readonly damage?: SpellDice;
  readonly damageType?: string;
  readonly saveAbility?: string;
  readonly saveDC?: number;
  readonly halfDamageOnSave?: boolean;
  readonly conditions?: string[];
  readonly activeEffect?: { type: EffectType; target: EffectTarget; value?: number };
  readonly affectsAllies?: boolean;
  readonly affectsEnemies?: boolean;
  readonly affectsSelf?: boolean;
}

/** Zone (area effect) declaration on a prepared spell. */
export interface SpellZoneDeclaration {
  readonly type: ZoneType;
  readonly radiusFeet: number;
  readonly shape?: ZoneShape;
  readonly attachToSelf?: boolean;
  readonly direction?: { x: number; y: number };
  readonly width?: number;
  readonly effects: SpellZoneEffectDeclaration[];
}

/**
 * A spell as it appears on a character's prepared spell list.
 *
 * This is the canonical shape for `sheet.preparedSpells[]` entries and is the
 * primary type consumed by `SpellActionHandler` and its sub-handlers.
 */
export interface PreparedSpellDefinition {
  readonly name: string;
  readonly level: number;
  readonly concentration?: boolean;
  readonly attackType?: 'ranged_spell' | 'melee_spell';
  readonly saveAbility?: string;
  readonly damage?: SpellDice;
  readonly damageType?: string;
  readonly halfDamageOnSave?: boolean;
  readonly conditions?: { onFailure?: string[] };
  readonly healing?: SpellDice;
  readonly isBonusAction?: boolean;
  readonly effects?: SpellEffectDeclaration[];
  readonly zone?: SpellZoneDeclaration;
  readonly upcastScaling?: UpcastScaling;
  /** Area of effect for multi-target spells (Burning Hands, Fireball, etc.) */
  readonly area?: AreaOfEffect;
  /** Spell range: number (feet), 'self', or 'touch'. Used for range validation before casting. */
  readonly range?: number | 'self' | 'touch';
  /** When true, the target gains no benefit from cover for saving throws against this spell (e.g. Sacred Flame). */
  readonly ignoresCover?: boolean;
  /** Die size upgrade when the target is already damaged (e.g., Toll the Dead d8 → d12). */
  readonly damageDiceSidesOnDamaged?: number;
  /** Effects applied on a successful spell attack hit (separate from `effects` which drives buff/debuff delivery routing). */
  readonly onHitEffects?: SpellEffectDeclaration[];
  /** On failed save, push the target this many feet away from the caster (e.g. Thunderwave 10ft). */
  readonly pushOnFailFeet?: number;
  /** Turn-end save: target repeats saving throw at end of each of its turns to end an applied condition. */
  readonly turnEndSave?: {
    readonly ability: string;
    readonly removeConditionOnSuccess: boolean;
  };
  /**
   * Multi-attack spell declaration (Eldritch Blast beams, Scorching Ray rays).
   * Each attack is a separate attack roll with independent hit/miss/crit.
   * - `cantrip` scaling: uses cantrip tiers (1/2/3/4 at character levels 1/5/11/17)
   * - `perLevel` scaling: baseCount + (castAtLevel - spell.level) extra attacks
   */
  readonly multiAttack?: {
    readonly baseCount: number;
    readonly scaling: 'cantrip' | 'perLevel';
  };
  /**
   * Auto-hit spell: bypasses attack rolls entirely (e.g. Magic Missile).
   * Damage is resolved directly without to-hit mechanics.
   */
  readonly autoHit?: boolean;
  /**
   * Base number of projectiles/darts for auto-hit spells (e.g. Magic Missile = 3).
   * For spells with upcast scaling, additional darts are computed as:
   *   dartCount + (castAtLevel - spell.level)
   */
  readonly dartCount?: number;
}

/**
 * Cantrip damage scaling per D&D 5e 2024.
 * Cantrips scale at character levels 5, 11, and 17:
 *   - Levels 1–4:  baseDiceCount dice
 *   - Levels 5–10: baseDiceCount × 2
 *   - Levels 11–16: baseDiceCount × 3
 *   - Levels 17+:  baseDiceCount × 4
 */
export function getCantripDamageDice(baseDiceCount: number, characterLevel: number): number {
  if (characterLevel >= 17) return baseDiceCount * 4;
  if (characterLevel >= 11) return baseDiceCount * 3;
  if (characterLevel >= 5) return baseDiceCount * 2;
  return baseDiceCount;
}

/**
 * Compute bonus dice from upcasting a spell at a higher slot level.
 * Returns null if the spell has no upcast scaling or castAtLevel is not above base.
 *
 * @param spell      The prepared spell definition (with optional upcastScaling)
 * @param castAtLevel The slot level used to cast (must be > spell.level for bonus)
 */
export function getUpcastBonusDice(
  spell: PreparedSpellDefinition,
  castAtLevel: number | undefined,
): { bonusDiceCount: number; diceSides: number } | null {
  if (!spell.upcastScaling?.additionalDice) return null;
  if (castAtLevel == null || castAtLevel <= spell.level) return null;
  const levelsAbove = castAtLevel - spell.level;
  return {
    bonusDiceCount: levelsAbove * spell.upcastScaling.additionalDice.diceCount,
    diceSides: spell.upcastScaling.additionalDice.diceSides,
  };
}

/**
 * Compute the number of independent attack rolls for a multi-attack spell.
 *
 * - Eldritch Blast (cantrip scaling): 1/2/3/4 beams at character levels 1/5/11/17
 * - Scorching Ray (perLevel scaling):  baseCount + (castAtLevel - spell.level)
 *
 * Returns 1 for spells without multiAttack.
 */
export function getSpellAttackCount(
  spell: PreparedSpellDefinition,
  characterLevel: number,
  castAtLevel?: number,
): number {
  if (!spell.multiAttack) return 1;
  const { baseCount, scaling } = spell.multiAttack;
  if (scaling === 'cantrip') {
    // Same tier breakpoints as cantrip damage scaling
    if (characterLevel >= 17) return baseCount * 4;
    if (characterLevel >= 11) return baseCount * 3;
    if (characterLevel >= 5) return baseCount * 2;
    return baseCount;
  }
  // perLevel: base + extra per slot level above spell's base
  const effectiveLevel = castAtLevel ?? spell.level;
  const extra = Math.max(0, effectiveLevel - spell.level);
  return baseCount + extra;
}
