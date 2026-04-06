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
