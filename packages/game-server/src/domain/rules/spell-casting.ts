/**
 * Shared spell-casting computations (D&D 5e 2024).
 *
 * - getSpellcastingModifier: ability modifier from spellcastingAbility + abilityScores
 * - computeSpellSaveDC: 8 + proficiency bonus + spellcasting modifier
 * - computeSpellAttackBonus: proficiency bonus + spellcasting modifier
 */

interface SpellSheet {
  spellSaveDC?: number;
  spellAttackBonus?: number;
  spellcastingAbility?: string;
  abilityScores?: Record<string, number>;
  proficiencyBonus?: number;
  level?: number;
}

/**
 * Compute the spellcasting ability modifier from a sheet-like object.
 * Returns 0 if spellcastingAbility or abilityScores is missing.
 */
export function getSpellcastingModifier(
  sheet: Pick<SpellSheet, 'spellcastingAbility' | 'abilityScores'> | null | undefined,
): number {
  const ab = sheet?.spellcastingAbility;
  if (!ab) return 0;
  const score = sheet?.abilityScores?.[ab] ?? 10;
  return Math.floor((score - 10) / 2);
}

/**
 * Compute spell save DC: 8 + proficiency bonus + spellcasting ability modifier.
 * Returns sheet.spellSaveDC if explicitly set (e.g. monster stat blocks).
 * Final fallback: 13 (CR ½ default) when no caster info is available.
 */
export function computeSpellSaveDC(sheet: SpellSheet | null | undefined): number {
  if (typeof sheet?.spellSaveDC === 'number') return sheet.spellSaveDC;
  const mod = getSpellcastingModifier(sheet);
  if (!sheet?.spellcastingAbility) return 13;
  const profBonus =
    sheet?.proficiencyBonus ??
    (typeof sheet?.level === 'number' ? Math.floor((sheet.level - 1) / 4) + 2 : 2);
  return 8 + profBonus + mod;
}

/**
 * Compute spell attack bonus: proficiency bonus + spellcasting ability modifier.
 * Returns sheet.spellAttackBonus if explicitly set (e.g. monster stat blocks).
 * Final fallback: +5 when no caster info is available.
 */
export function computeSpellAttackBonus(sheet: SpellSheet | null | undefined): number {
  if (typeof sheet?.spellAttackBonus === 'number') return sheet.spellAttackBonus;
  const mod = getSpellcastingModifier(sheet);
  if (!sheet?.spellcastingAbility) return 5;
  const profBonus =
    sheet?.proficiencyBonus ??
    (typeof sheet?.level === 'number' ? Math.floor((sheet.level - 1) / 4) + 2 : 2);
  return profBonus + mod;
}
