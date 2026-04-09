/**
 * Canonical Spell Catalog — Type Definitions
 *
 * Extends PreparedSpellDefinition with metadata fields (school, casting time,
 * components, class lists, description) to serve as the single source of truth
 * for spell mechanics across the entire system.
 *
 * Layer: Domain (pure data, no side effects).
 */

import type { PreparedSpellDefinition } from '../prepared-spell-definition.js';

export type SpellSchool =
  | 'abjuration'
  | 'conjuration'
  | 'divination'
  | 'enchantment'
  | 'evocation'
  | 'illusion'
  | 'necromancy'
  | 'transmutation';

export interface CanonicalSpell extends PreparedSpellDefinition {
  readonly school: SpellSchool;
  readonly ritual?: boolean;
  readonly castingTime: 'action' | 'bonus_action' | 'reaction';
  readonly range: number | 'self' | 'touch';
  readonly components?: { readonly v?: boolean; readonly s?: boolean; readonly m?: string };
  readonly classLists: readonly string[];
  readonly description: string;
}

/**
 * How a spell is being cast. Affects slot consumption and casting time.
 *
 * - `normal`: Standard casting — spends a spell slot, uses the spell's standard casting time.
 * - `ritual`: Ritual casting — does NOT consume a spell slot, but takes 10 minutes longer.
 *   Only spells with `ritual: true` in the catalog can be cast this way.
 *   In combat, ritual casting is effectively impossible (10+ minutes).
 *
 * TODO: SS-L7 — Wire into SpellActionHandler castInfo and prepareSpellCast.
 * When castingMode is 'ritual', skip spell slot deduction in prepareSpellCast.
 * Add validation: reject ritual casting for non-ritual spells, reject in active combat.
 */
export type SpellCastingMode = 'normal' | 'ritual';
