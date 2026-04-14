/**
 * Canonical Spell Catalog — Index / Public API
 *
 * Aggregates all spell level catalogs into a single searchable collection.
 * Provides lookup functions by name, level, class, and school.
 *
 * Layer: Domain (pure data, no side effects).
 */

import { CANTRIP_CATALOG } from './cantrips.js';
import { LEVEL_1_CATALOG } from './level-1.js';
import { LEVEL_2_CATALOG } from './level-2.js';
import { LEVEL_3_CATALOG } from './level-3.js';
import { LEVEL_4_CATALOG } from './level-4.js';
import { LEVEL_5_CATALOG } from './level-5.js';
import type { CanonicalSpell } from './types.js';

const ALL_SPELLS: readonly CanonicalSpell[] = [
  ...CANTRIP_CATALOG,
  ...LEVEL_1_CATALOG,
  ...LEVEL_2_CATALOG,
  ...LEVEL_3_CATALOG,
  ...LEVEL_4_CATALOG,
  ...LEVEL_5_CATALOG,
];

const SPELL_BY_NAME = new Map<string, CanonicalSpell>(
  ALL_SPELLS.map(s => [s.name.toLowerCase(), s]),
);

export function getCanonicalSpell(name: string): CanonicalSpell | null {
  return SPELL_BY_NAME.get(name.toLowerCase()) ?? null;
}

export function listSpellsByLevel(level: number): CanonicalSpell[] {
  return ALL_SPELLS.filter(s => s.level === level);
}

export function listSpellsByClass(classId: string): CanonicalSpell[] {
  const lower = classId.toLowerCase();
  return ALL_SPELLS.filter(s => s.classLists.some(c => c.toLowerCase() === lower));
}

export function listSpellsBySchool(school: string): CanonicalSpell[] {
  const lower = school.toLowerCase();
  return ALL_SPELLS.filter(s => s.school === lower);
}

export { SPELL_BY_NAME as SPELL_CATALOG };
export type { CanonicalSpell, SpellSchool, SpellCastingMode } from './types.js';
