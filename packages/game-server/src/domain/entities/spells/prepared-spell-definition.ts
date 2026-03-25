/**
 * PreparedSpellDefinition — domain interface for a spell on a character's prepared list.
 *
 * This captures the shape of entries in `character.sheet.preparedSpells[]`.
 * It is the source of truth for what data the spell action handler expects.
 */

import type { EffectType, EffectTarget, EffectDuration } from '../combat/effects.js';
import type { ZoneType, ZoneShape, ZoneEffectTrigger } from '../combat/zones.js';

/** Dice expression: NdS+M */
export interface SpellDice {
  readonly diceCount: number;
  readonly diceSides: number;
  readonly modifier?: number;
}

/** Effect declaration attached to a buff/debuff spell. */
export interface SpellEffectDeclaration {
  readonly type: EffectType;
  readonly target: EffectTarget;
  readonly value?: number;
  readonly diceValue?: { count: number; sides: number };
  readonly damageType?: string;
  readonly duration: EffectDuration;
  readonly roundsRemaining?: number;
  readonly triggerAt?: 'start_of_turn' | 'end_of_turn' | 'on_voluntary_move';
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
