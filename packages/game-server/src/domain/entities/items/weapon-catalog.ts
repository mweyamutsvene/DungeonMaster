/**
 * Canonical D&D 5e 2024 weapon catalog.
 *
 * Single source of truth for weapon properties, damage, mastery, and classification.
 * All runtime property checks should resolve through this catalog rather than
 * relying on ad-hoc string arrays on character sheets.
 *
 * Source: 2024 Player's Handbook, Equipment chapter.
 */

// ─── Weapon property type ────────────────────────────────────────────────

/**
 * Standard D&D 5e weapon properties.
 * These are the canonical property names used throughout the codebase.
 */
export type WeaponProperty =
  | "ammunition"
  | "finesse"
  | "heavy"
  | "light"
  | "loading"
  | "reach"
  | "thrown"
  | "two-handed"
  | "versatile";

/**
 * Weapon category: simple or martial.
 */
export type WeaponCategory = "simple" | "martial";

/**
 * Whether the weapon is primarily melee or ranged.
 */
export type WeaponKind = "melee" | "ranged";

/**
 * Damage type keywords.
 */
export type PhysicalDamageType = "bludgeoning" | "piercing" | "slashing";

// ─── Catalog entry ───────────────────────────────────────────────────────

export interface WeaponCatalogEntry {
  readonly name: string;
  readonly category: WeaponCategory;
  readonly kind: WeaponKind;
  readonly damage: {
    readonly diceCount: number;
    readonly diceSides: number;
    readonly type: PhysicalDamageType;
  };
  /** Canonical property list (lowercase). */
  readonly properties: readonly WeaponProperty[];
  /** Range in feet for thrown/ammunition weapons: [normal, long]. */
  readonly range?: readonly [number, number];
  /** Versatile damage die sides (e.g. 10 for d10). */
  readonly versatileDiceSides?: number;
  /** Ammunition type (e.g. "Arrow", "Bolt", "Bullet", "Needle"). */
  readonly ammunitionType?: string;
  /** D&D 2024 weapon mastery property. */
  readonly mastery?: string;
  /** Weight in pounds. */
  readonly weightLb?: number;
}

// ─── Catalog data ────────────────────────────────────────────────────────

const WEAPONS: readonly WeaponCatalogEntry[] = [
  // ── Simple Melee Weapons ──
  { name: "Club",          category: "simple", kind: "melee",  damage: { diceCount: 1, diceSides: 4,  type: "bludgeoning" }, properties: ["light"],                          mastery: "slow",   weightLb: 2 },
  { name: "Dagger",        category: "simple", kind: "melee",  damage: { diceCount: 1, diceSides: 4,  type: "piercing" },    properties: ["finesse", "light", "thrown"],     range: [20, 60],   mastery: "nick",   weightLb: 1 },
  { name: "Greatclub",     category: "simple", kind: "melee",  damage: { diceCount: 1, diceSides: 8,  type: "bludgeoning" }, properties: ["two-handed"],                     mastery: "push",   weightLb: 10 },
  { name: "Handaxe",       category: "simple", kind: "melee",  damage: { diceCount: 1, diceSides: 6,  type: "slashing" },    properties: ["light", "thrown"],                range: [20, 60],   mastery: "vex",    weightLb: 2 },
  { name: "Javelin",       category: "simple", kind: "melee",  damage: { diceCount: 1, diceSides: 6,  type: "piercing" },    properties: ["thrown"],                         range: [30, 120],  mastery: "slow",   weightLb: 2 },
  { name: "Light Hammer",  category: "simple", kind: "melee",  damage: { diceCount: 1, diceSides: 4,  type: "bludgeoning" }, properties: ["light", "thrown"],                range: [20, 60],   mastery: "nick",   weightLb: 2 },
  { name: "Mace",          category: "simple", kind: "melee",  damage: { diceCount: 1, diceSides: 6,  type: "bludgeoning" }, properties: [],                                 mastery: "sap",    weightLb: 4 },
  { name: "Quarterstaff",  category: "simple", kind: "melee",  damage: { diceCount: 1, diceSides: 6,  type: "bludgeoning" }, properties: ["versatile"],                      versatileDiceSides: 8, mastery: "topple", weightLb: 4 },
  { name: "Sickle",        category: "simple", kind: "melee",  damage: { diceCount: 1, diceSides: 4,  type: "slashing" },    properties: ["light"],                          mastery: "nick",   weightLb: 2 },
  { name: "Spear",         category: "simple", kind: "melee",  damage: { diceCount: 1, diceSides: 6,  type: "piercing" },    properties: ["thrown", "versatile"],            range: [20, 60],   versatileDiceSides: 8, mastery: "sap", weightLb: 3 },

  // ── Simple Ranged Weapons ──
  { name: "Dart",            category: "simple", kind: "ranged", damage: { diceCount: 1, diceSides: 4, type: "piercing" },    properties: ["finesse", "thrown"],              range: [20, 60],   mastery: "vex",  weightLb: 0.25 },
  { name: "Light Crossbow",  category: "simple", kind: "ranged", damage: { diceCount: 1, diceSides: 8, type: "piercing" },    properties: ["ammunition", "loading", "two-handed"], range: [80, 320], ammunitionType: "Bolt",   mastery: "slow", weightLb: 5 },
  { name: "Shortbow",        category: "simple", kind: "ranged", damage: { diceCount: 1, diceSides: 6, type: "piercing" },    properties: ["ammunition", "two-handed"],       range: [80, 320],  ammunitionType: "Arrow",  mastery: "vex",  weightLb: 2 },
  { name: "Sling",           category: "simple", kind: "ranged", damage: { diceCount: 1, diceSides: 4, type: "bludgeoning" }, properties: ["ammunition"],                     range: [30, 120],  ammunitionType: "Bullet", mastery: "slow" },

  // ── Martial Melee Weapons ──
  { name: "Battleaxe",    category: "martial", kind: "melee",  damage: { diceCount: 1, diceSides: 8,  type: "slashing" },    properties: ["versatile"],                      versatileDiceSides: 10, mastery: "topple", weightLb: 4 },
  { name: "Flail",        category: "martial", kind: "melee",  damage: { diceCount: 1, diceSides: 8,  type: "bludgeoning" }, properties: [],                                 mastery: "sap",    weightLb: 2 },
  { name: "Glaive",       category: "martial", kind: "melee",  damage: { diceCount: 1, diceSides: 10, type: "slashing" },    properties: ["heavy", "reach", "two-handed"],   mastery: "graze",  weightLb: 6 },
  { name: "Greataxe",     category: "martial", kind: "melee",  damage: { diceCount: 1, diceSides: 12, type: "slashing" },    properties: ["heavy", "two-handed"],            mastery: "cleave", weightLb: 7 },
  { name: "Greatsword",   category: "martial", kind: "melee",  damage: { diceCount: 2, diceSides: 6,  type: "slashing" },    properties: ["heavy", "two-handed"],            mastery: "graze",  weightLb: 6 },
  { name: "Halberd",      category: "martial", kind: "melee",  damage: { diceCount: 1, diceSides: 10, type: "slashing" },    properties: ["heavy", "reach", "two-handed"],   mastery: "cleave", weightLb: 6 },
  { name: "Lance",        category: "martial", kind: "melee",  damage: { diceCount: 1, diceSides: 10, type: "piercing" },    properties: ["heavy", "reach", "two-handed"],   mastery: "topple", weightLb: 6 },
  { name: "Longsword",    category: "martial", kind: "melee",  damage: { diceCount: 1, diceSides: 8,  type: "slashing" },    properties: ["versatile"],                      versatileDiceSides: 10, mastery: "sap", weightLb: 3 },
  { name: "Maul",         category: "martial", kind: "melee",  damage: { diceCount: 2, diceSides: 6,  type: "bludgeoning" }, properties: ["heavy", "two-handed"],            mastery: "topple", weightLb: 10 },
  { name: "Morningstar",  category: "martial", kind: "melee",  damage: { diceCount: 1, diceSides: 8,  type: "piercing" },    properties: [],                                 mastery: "sap",    weightLb: 4 },
  { name: "Pike",         category: "martial", kind: "melee",  damage: { diceCount: 1, diceSides: 10, type: "piercing" },    properties: ["heavy", "reach", "two-handed"],   mastery: "push",   weightLb: 18 },
  { name: "Rapier",       category: "martial", kind: "melee",  damage: { diceCount: 1, diceSides: 8,  type: "piercing" },    properties: ["finesse"],                        mastery: "vex",    weightLb: 2 },
  { name: "Scimitar",     category: "martial", kind: "melee",  damage: { diceCount: 1, diceSides: 6,  type: "slashing" },    properties: ["finesse", "light"],               mastery: "nick",   weightLb: 3 },
  { name: "Shortsword",   category: "martial", kind: "melee",  damage: { diceCount: 1, diceSides: 6,  type: "piercing" },    properties: ["finesse", "light"],               mastery: "vex",    weightLb: 2 },
  { name: "Trident",      category: "martial", kind: "melee",  damage: { diceCount: 1, diceSides: 8,  type: "piercing" },    properties: ["thrown", "versatile"],            range: [20, 60],   versatileDiceSides: 10, mastery: "topple", weightLb: 4 },
  { name: "War Pick",     category: "martial", kind: "melee",  damage: { diceCount: 1, diceSides: 8,  type: "piercing" },    properties: ["versatile"],                      versatileDiceSides: 10, mastery: "sap", weightLb: 2 },
  { name: "Warhammer",    category: "martial", kind: "melee",  damage: { diceCount: 1, diceSides: 8,  type: "bludgeoning" }, properties: ["versatile"],                      versatileDiceSides: 10, mastery: "push", weightLb: 5 },
  { name: "Whip",         category: "martial", kind: "melee",  damage: { diceCount: 1, diceSides: 4,  type: "slashing" },    properties: ["finesse", "reach"],               mastery: "slow",   weightLb: 3 },

  // ── Martial Ranged Weapons ──
  { name: "Blowgun",        category: "martial", kind: "ranged", damage: { diceCount: 0, diceSides: 0, type: "piercing" },    properties: ["ammunition", "loading"],           range: [25, 100],  ammunitionType: "Needle", mastery: "vex",  weightLb: 1 },
  { name: "Hand Crossbow",  category: "martial", kind: "ranged", damage: { diceCount: 1, diceSides: 6, type: "piercing" },    properties: ["ammunition", "light", "loading"],  range: [30, 120],  ammunitionType: "Bolt",   mastery: "vex",  weightLb: 3 },
  { name: "Heavy Crossbow", category: "martial", kind: "ranged", damage: { diceCount: 1, diceSides: 10, type: "piercing" },   properties: ["ammunition", "heavy", "loading", "two-handed"], range: [100, 400], ammunitionType: "Bolt", mastery: "push", weightLb: 18 },
  { name: "Longbow",        category: "martial", kind: "ranged", damage: { diceCount: 1, diceSides: 8, type: "piercing" },    properties: ["ammunition", "heavy", "two-handed"], range: [150, 600], ammunitionType: "Arrow", mastery: "slow", weightLb: 2 },
  { name: "Musket",         category: "martial", kind: "ranged", damage: { diceCount: 1, diceSides: 12, type: "piercing" },   properties: ["ammunition", "loading", "two-handed"], range: [40, 120], ammunitionType: "Bullet", mastery: "slow", weightLb: 10 },
  { name: "Pistol",         category: "martial", kind: "ranged", damage: { diceCount: 1, diceSides: 10, type: "piercing" },   properties: ["ammunition", "loading"],           range: [30, 90],   ammunitionType: "Bullet", mastery: "vex",  weightLb: 3 },
] as const;

// ─── Lookup index (case-insensitive) ─────────────────────────────────────

const BY_NAME = new Map<string, WeaponCatalogEntry>(
  WEAPONS.map((w) => [w.name.toLowerCase(), w]),
);

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Look up a weapon by name (case-insensitive).
 * Returns `undefined` for improvised, natural, or unrecognized weapons.
 */
export function lookupWeapon(name: string): WeaponCatalogEntry | undefined {
  return BY_NAME.get(name.toLowerCase());
}

/**
 * Get all standard weapons in the catalog.
 */
export function getAllWeapons(): readonly WeaponCatalogEntry[] {
  return WEAPONS;
}

/**
 * Check if a weapon has a specific property by name.
 * Works with either a catalog entry or a raw `properties` string array from a character sheet.
 *
 * @param weapon - Weapon name, catalog entry, or raw properties array
 * @param property - The property to check for (case-insensitive)
 */
export function hasWeaponProperty(
  weapon: string | WeaponCatalogEntry | readonly string[] | undefined,
  property: WeaponProperty | string,
): boolean {
  if (!weapon) return false;

  const props = getWeaponProperties(weapon);
  const needle = property.toLowerCase();
  return props.some((p) => p.toLowerCase() === needle || p.toLowerCase().startsWith(needle));
}

/**
 * Resolve the canonical properties for a weapon.
 * If given a name string, looks up from catalog first, falls back to empty.
 * If given a string array (from character sheet), returns it as-is.
 * If given a catalog entry, returns its properties.
 */
export function getWeaponProperties(
  weapon: string | WeaponCatalogEntry | readonly string[],
): readonly string[] {
  if (Array.isArray(weapon)) return weapon;
  if (typeof weapon === "object" && "properties" in weapon) return weapon.properties;
  if (typeof weapon === "string") return lookupWeapon(weapon)?.properties ?? [];
  return [];
}

/**
 * Parse a thrown range string like "Thrown (20/60)" or "20/60" into [normal, long].
 * Returns undefined if the string doesn't contain a recognizable range.
 */
export function parseThrownRange(
  rangeStr: string,
): [number, number] | undefined {
  const match = rangeStr.match(/(\d+)\s*\/\s*(\d+)/);
  if (!match) return undefined;
  return [parseInt(match[1], 10), parseInt(match[2], 10)];
}

/**
 * Get the thrown range for a weapon, checking both the catalog and property strings.
 */
export function getWeaponThrownRange(
  weaponName: string,
  properties?: readonly string[],
): [number, number] | undefined {
  // Check catalog first
  const entry = lookupWeapon(weaponName);
  if (entry?.range && hasWeaponProperty(entry, "thrown")) return [...entry.range] as [number, number];

  // Fall back to parsing property strings
  if (properties) {
    const thrownProp = properties.find((p) => p.toLowerCase().startsWith("thrown"));
    if (thrownProp) return parseThrownRange(thrownProp) ?? [20, 60];
  }
  return undefined;
}

// ─── Attack enrichment ───────────────────────────────────────────────────

/**
 * An attack entry from a character sheet (the subset of fields we read/write).
 */
interface SheetAttack {
  name?: string;
  properties?: string[];
  mastery?: string;
  versatileDamage?: { diceSides: number };
  [key: string]: unknown;
}

/**
 * Enrich an attack entry with canonical weapon catalog data.
 *
 * If the attack already has `properties`, it's returned unchanged.
 * Otherwise, looks up the weapon name in the catalog and adds:
 * - `properties` (e.g. ["finesse", "light"])
 * - `mastery` (e.g. "vex")
 * - `versatileDamage` (e.g. { diceSides: 10 })
 *
 * Non-catalog weapons (natural attacks, cantrips, etc.) are returned as-is.
 */
export function enrichAttackProperties<T extends SheetAttack>(attack: T): T {
  // Already enriched or no name to look up
  if (attack.properties && attack.properties.length > 0) return attack;
  if (!attack.name) return attack;

  const entry = lookupWeapon(attack.name);
  if (!entry) return attack;

  const enriched: T = { ...attack };
  enriched.properties = [...entry.properties];
  if (entry.mastery && !enriched.mastery) {
    enriched.mastery = entry.mastery;
  }
  if (entry.versatileDiceSides && !enriched.versatileDamage) {
    enriched.versatileDamage = { diceSides: entry.versatileDiceSides };
  }
  return enriched;
}

/**
 * Enrich all attacks in a character sheet with canonical weapon catalog data.
 * Returns the sheet with a new `attacks` array (if it existed and had items to enrich).
 * If the sheet has no attacks, returns it unchanged.
 */
export function enrichSheetAttacks(sheet: Record<string, unknown>): Record<string, unknown> {
  const attacks = sheet.attacks;
  if (!Array.isArray(attacks) || attacks.length === 0) return sheet;

  const enriched = attacks.map((a: unknown) => {
    if (!a || typeof a !== "object") return a;
    return enrichAttackProperties(a as SheetAttack);
  });

  return { ...sheet, attacks: enriched };
}
