/**
 * Canonical D&D 5e 2024 armor catalog.
 *
 * Single source of truth for armor AC formulas, categories, and properties.
 *
 * Source: 2024 Player's Handbook, Equipment chapter.
 */

import type { EquippedArmorCategory, EquippedArmorClassFormula } from "./equipped-items.js";

// ─── Catalog entry ───────────────────────────────────────────────────────

export interface ArmorCatalogEntry {
  readonly name: string;
  readonly category: EquippedArmorCategory;
  readonly acFormula: EquippedArmorClassFormula;
  /** Minimum STR score required to avoid speed penalty, or undefined. */
  readonly strengthRequirement?: number;
  /** Whether the armor imposes stealth disadvantage. */
  readonly stealthDisadvantage: boolean;
  /** Weight in pounds. */
  readonly weightLb?: number;
  /** Don/doff time description. */
  readonly donTime: string;
  readonly doffTime: string;
}

// ─── Catalog data ────────────────────────────────────────────────────────

const ARMOR: readonly ArmorCatalogEntry[] = [
  // ── Light Armor (1 minute to Don/Doff) ──
  { name: "Padded",          category: "light",  acFormula: { base: 11, addDexterityModifier: true },                             stealthDisadvantage: true,  weightLb: 8,  donTime: "1 minute", doffTime: "1 minute" },
  { name: "Leather",         category: "light",  acFormula: { base: 11, addDexterityModifier: true },                             stealthDisadvantage: false, weightLb: 10, donTime: "1 minute", doffTime: "1 minute" },
  { name: "Studded Leather", category: "light",  acFormula: { base: 12, addDexterityModifier: true },                             stealthDisadvantage: false, weightLb: 13, donTime: "1 minute", doffTime: "1 minute" },

  // ── Medium Armor (5 minutes to Don / 1 minute to Doff) ──
  { name: "Hide",        category: "medium", acFormula: { base: 12, addDexterityModifier: true, dexterityModifierMax: 2 },        stealthDisadvantage: false, weightLb: 12, donTime: "5 minutes", doffTime: "1 minute" },
  { name: "Chain Shirt", category: "medium", acFormula: { base: 13, addDexterityModifier: true, dexterityModifierMax: 2 },        stealthDisadvantage: false, weightLb: 20, donTime: "5 minutes", doffTime: "1 minute" },
  { name: "Scale Mail",  category: "medium", acFormula: { base: 14, addDexterityModifier: true, dexterityModifierMax: 2 },        stealthDisadvantage: true,  weightLb: 45, donTime: "5 minutes", doffTime: "1 minute" },
  { name: "Breastplate", category: "medium", acFormula: { base: 14, addDexterityModifier: true, dexterityModifierMax: 2 },        stealthDisadvantage: false, weightLb: 20, donTime: "5 minutes", doffTime: "1 minute" },
  { name: "Half Plate",  category: "medium", acFormula: { base: 15, addDexterityModifier: true, dexterityModifierMax: 2 },        stealthDisadvantage: true,  weightLb: 40, donTime: "5 minutes", doffTime: "1 minute" },

  // ── Heavy Armor (10 minutes to Don / 5 minutes to Doff) ──
  { name: "Ring Mail",  category: "heavy", acFormula: { base: 14, addDexterityModifier: false },                                  stealthDisadvantage: true,  weightLb: 40, donTime: "10 minutes", doffTime: "5 minutes" },
  { name: "Chain Mail", category: "heavy", acFormula: { base: 16, addDexterityModifier: false }, strengthRequirement: 13,         stealthDisadvantage: true,  weightLb: 55, donTime: "10 minutes", doffTime: "5 minutes" },
  { name: "Splint",     category: "heavy", acFormula: { base: 17, addDexterityModifier: false }, strengthRequirement: 15,         stealthDisadvantage: true,  weightLb: 60, donTime: "10 minutes", doffTime: "5 minutes" },
  { name: "Plate",      category: "heavy", acFormula: { base: 18, addDexterityModifier: false }, strengthRequirement: 15,         stealthDisadvantage: true,  weightLb: 65, donTime: "10 minutes", doffTime: "5 minutes" },
] as const;

// ─── Lookup index (case-insensitive) ─────────────────────────────────────

const BY_NAME = new Map<string, ArmorCatalogEntry>(
  ARMOR.map((a) => [a.name.toLowerCase(), a]),
);

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Look up armor by name (case-insensitive).
 */
export function lookupArmor(name: string): ArmorCatalogEntry | undefined {
  return BY_NAME.get(name.toLowerCase());
}

/**
 * Get all standard armor in the catalog.
 */
export function getAllArmor(): readonly ArmorCatalogEntry[] {
  return ARMOR;
}

/**
 * Derive AC from an armor name + ability scores, using the armor catalog.
 *
 * If the armor name is found in the catalog, computes AC per the D&D 5e 2024
 * formula (base + capped DEX modifier). Optionally adds +2 for a shield.
 *
 * Returns `undefined` if the armor name is not in the catalog (custom/magic
 * armor, unarmored, etc.).
 */
export function deriveACFromArmor(
  armorName: string,
  dexterityModifier: number,
  hasShield = false,
): number | undefined {
  const entry = lookupArmor(armorName);
  if (!entry) return undefined;

  const { acFormula } = entry;
  const cappedDex = typeof acFormula.dexterityModifierMax === "number"
    ? Math.min(dexterityModifier, acFormula.dexterityModifierMax)
    : dexterityModifier;

  let ac = acFormula.base + (acFormula.addDexterityModifier ? cappedDex : 0);

  if (hasShield) {
    ac += 2;  // Standard shield bonus
  }

  return ac;
}

/**
 * Enrich a character sheet with armor metadata from the catalog.
 *
 * If the sheet has an `equipment` array containing an armor entry and no
 * `equippedArmor` field, looks up the armor in the catalog and adds the
 * `equippedArmor` field with the AC formula, category, and name.
 *
 * This allows the combat system to compute AC from the catalog rather than
 * relying solely on the pre-computed `armorClass` field.
 */
export function enrichSheetArmor(sheet: Record<string, unknown>): Record<string, unknown> {
  // Don't overwrite if already present
  if (sheet.equippedArmor) return sheet;

  const equipment = sheet.equipment;
  if (!Array.isArray(equipment)) return sheet;

  const armorItem = equipment.find(
    (e: unknown) => e && typeof e === "object" && (e as Record<string, unknown>).type === "armor",
  ) as Record<string, unknown> | undefined;

  if (!armorItem || typeof armorItem.name !== "string") return sheet;

  const entry = lookupArmor(armorItem.name);
  if (!entry) return sheet;

  const shieldItem = equipment.find(
    (e: unknown) => e && typeof e === "object" && (e as Record<string, unknown>).type === "shield",
  );

  return {
    ...sheet,
    equippedArmor: {
      name: entry.name,
      category: entry.category,
      acFormula: { ...entry.acFormula },
      stealthDisadvantage: entry.stealthDisadvantage,
    },
    ...(shieldItem ? { equippedShield: { name: "Shield", armorClassBonus: 2 } } : {}),
  };
}
