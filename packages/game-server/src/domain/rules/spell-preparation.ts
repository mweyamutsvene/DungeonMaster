/**
 * Spell preparation / known-spells rules — D&D 5e 2024.
 *
 * Prepared casters (Cleric, Druid, Paladin, Wizard): choose spells after long rest.
 *   Max prepared = ability modifier + class level (min 1).
 * Known casters (Bard, Ranger, Sorcerer, Warlock): fixed list that changes on level up.
 *
 * This module exports pure functions; it does NOT import Fastify/Prisma.
 */

export type SpellCasterType = "prepared" | "known" | "none";
type SpellListEntry = string | { name: string };

interface SpellCasterInfo {
  type: SpellCasterType;
  ability: string;
}

const CASTER_INFO: Record<string, SpellCasterInfo> = {
  cleric:  { type: "prepared", ability: "wisdom" },
  druid:   { type: "prepared", ability: "wisdom" },
  paladin: { type: "prepared", ability: "charisma" },
  wizard:  { type: "prepared", ability: "intelligence" },
  bard:    { type: "known",    ability: "charisma" },
  ranger:  { type: "known",    ability: "wisdom" },
  sorcerer:{ type: "known",    ability: "charisma" },
  warlock: { type: "known",    ability: "charisma" },
};

/**
 * Determine whether a class is a prepared caster, known caster, or non-caster.
 */
export function getSpellCasterType(classId: string): SpellCasterType {
  return CASTER_INFO[classId.toLowerCase()]?.type ?? "none";
}

/**
 * Max number of prepared spells for a prepared caster.
 * Formula: ability modifier + class level (minimum 1).
 * Returns 0 for non-prepared casters.
 */
export function getMaxPreparedSpells(classId: string, classLevel: number, abilityModifier: number): number {
  const info = CASTER_INFO[classId.toLowerCase()];
  if (!info || info.type !== "prepared") return 0;
  return Math.max(1, abilityModifier + classLevel);
}

/**
 * Check if a spell is in the character's prepared or known list.
 * When the lists are empty/undefined, returns true for backward compatibility
 * (legacy characters that haven't set up spell preparation).
 */
export function isSpellAvailable(
  spellId: string,
  preparedSpells: readonly SpellListEntry[] | undefined,
  knownSpells: readonly SpellListEntry[] | undefined,
): boolean {
  const target = spellId.trim().toLowerCase();
  const preparedNames = normalizeSpellNames(preparedSpells);
  const knownNames = normalizeSpellNames(knownSpells);

  // Backward compatibility: if no lists are set, allow any spell
  if (preparedNames.length === 0 && knownNames.length === 0) {
    return true;
  }

  if (preparedNames.includes(target)) {
    return true;
  }
  if (knownNames.includes(target)) {
    return true;
  }

  return false;
}

function normalizeSpellNames(spells: readonly SpellListEntry[] | undefined): string[] {
  if (!spells || spells.length === 0) return [];

  const names: string[] = [];
  for (const entry of spells) {
    if (typeof entry === "string") {
      const normalized = entry.trim().toLowerCase();
      if (normalized.length > 0) names.push(normalized);
      continue;
    }
    if (
      entry &&
      typeof entry === "object" &&
      "name" in entry &&
      typeof entry.name === "string"
    ) {
      const normalized = entry.name.trim().toLowerCase();
      if (normalized.length > 0) names.push(normalized);
    }
  }

  return names;
}
