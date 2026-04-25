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

/**
 * Material component declaration. Two forms:
 *  - `string` — descriptive only; component pouch / arcane focus satisfies. Backward-compat default.
 *  - `StructuredMaterialComponent` — explicit cost / consumed semantics for spells with required
 *    expensive components (Revivify 300gp diamond, Continual Flame 50gp ruby dust, etc.).
 */
export type MaterialComponent = string | StructuredMaterialComponent;

export interface StructuredMaterialComponent {
  /** Human-readable description (always shown). */
  readonly description: string;
  /** Item name keyword to match against inventory (e.g., "diamond", "ruby"). */
  readonly itemKeyword?: string;
  /** Minimum GP value the matching item must have. Implies pouch does NOT satisfy. */
  readonly costGp?: number;
  /** When true, the matching item is removed from inventory on cast. */
  readonly consumed?: boolean;
  /**
   * When true (default for non-costGp components), a generic component pouch / arcane focus
   * satisfies this component. Set false explicitly when a pouch should NOT satisfy.
   * If costGp is set, this defaults to false.
   */
  readonly componentPouchSatisfies?: boolean;
}

export interface CanonicalSpell extends PreparedSpellDefinition {
  readonly school: SpellSchool;
  readonly ritual?: boolean;
  readonly castingTime: 'action' | 'bonus_action' | 'reaction';
  readonly range: number | 'self' | 'touch';
  readonly components?: { readonly v?: boolean; readonly s?: boolean; readonly m?: MaterialComponent };
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
 * Ritual slot-skip is wired in `prepareSpellCast()` via `castAsRitual` parameter.
 * TODO: SS-L7 — Wire SpellCastingMode into SpellActionHandler castInfo and the API request schema
 * so callers can explicitly request ritual casting. Currently `castAsRitual` must be
 * passed programmatically.
 */
export type SpellCastingMode = 'normal' | 'ritual';
