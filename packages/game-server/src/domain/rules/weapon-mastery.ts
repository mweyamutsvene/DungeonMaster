/**
 * D&D 5e 2024 Weapon Mastery System
 *
 * Each weapon type has a mastery property that can be used by characters
 * with the Weapon Mastery class feature. Mastery effects trigger automatically
 * on hit (or miss, for Graze) without player opt-in.
 *
 * Classes with Weapon Mastery: Fighter (3), Barbarian (2), Paladin (2), Ranger (2), Rogue (2)
 */

/**
 * Weapon mastery property keywords.
 */
export type WeaponMasteryProperty =
  | "cleave"   // On hit → free attack vs adjacent creature (no ability mod on damage), once/turn
  | "graze"    // On miss → deal ability modifier damage (same type as weapon)
  | "nick"     // Light weapon's extra attack is part of Attack action (not bonus action), once/turn
  | "push"     // On hit → push target up to 10ft (Large or smaller)
  | "sap"      // On hit → target has disadvantage on next attack before your next turn
  | "slow"     // On hit + damage → reduce target speed by 10ft until start of your next turn
  | "topple"   // On hit → CON save (DC 8 + ability mod + prof) or Prone
  | "vex";     // On hit + damage → advantage on next attack vs that target before end of your next turn

/** Minimal character sheet shape used by weapon mastery lookups. */
export interface WeaponMasterySheet {
  className?: string;
  class?: string;
  weaponMasteries?: string[];
}

/**
 * Standard D&D 5e 2024 weapon → mastery property mapping.
 *
 * Source: 2024 Player's Handbook, Equipment chapter.
 */
export const WEAPON_MASTERY_MAP: Readonly<Record<string, WeaponMasteryProperty>> = {
  // Simple Melee Weapons
  "club": "slow",
  "dagger": "nick",
  "greatclub": "push",
  "handaxe": "vex",
  "javelin": "slow",
  "light hammer": "nick",
  "mace": "sap",
  "quarterstaff": "topple",
  "sickle": "nick",
  "spear": "sap",

  // Simple Ranged Weapons
  "light crossbow": "slow",
  "dart": "vex",
  "shortbow": "vex",
  "sling": "slow",

  // Martial Melee Weapons
  "battleaxe": "topple",
  "flail": "sap",
  "glaive": "graze",
  "greataxe": "cleave",
  "greatsword": "graze",
  "halberd": "sap",
  "lance": "topple",
  "longsword": "sap",
  "maul": "topple",
  "morningstar": "sap",
  "pike": "push",
  "rapier": "vex",
  "scimitar": "nick",
  "shortsword": "vex",
  "trident": "topple",
  "war pick": "sap",
  "warhammer": "push",
  "whip": "slow",

  // Martial Ranged Weapons
  "hand crossbow": "vex",
  "heavy crossbow": "push",
  "longbow": "slow",
  "musket": "slow",
  "pistol": "vex",
};

/**
 * Get the mastery property for a weapon by name (case-insensitive).
 */
export function getWeaponMastery(weaponName: string): WeaponMasteryProperty | undefined {
  return WEAPON_MASTERY_MAP[weaponName.toLowerCase()];
}

/**
 * Classes that gain Weapon Mastery at level 1 and the number of weapons they master.
 */
const WEAPON_MASTERY_CLASSES: Readonly<Record<string, number>> = {
  fighter: 3,
  barbarian: 2,
  paladin: 2,
  ranger: 2,
  rogue: 2,
};

/**
 * Check if a character has the Weapon Mastery class feature.
 *
 * @param sheet - The character sheet (must have `className` or `class`)
 * @param className - Optional explicit class name override
 * @returns true if the character's class grants Weapon Mastery
 */
export function hasWeaponMasteryFeature(
  sheet: WeaponMasterySheet,
  className?: string,
): boolean {
  const cls = className ?? sheet.className ?? sheet.class ?? "";
  return cls.toLowerCase() in WEAPON_MASTERY_CLASSES;
}

/**
 * Get the number of weapon masteries a character's class grants.
 */
export function getWeaponMasteryCount(
  sheet: WeaponMasterySheet,
  className?: string,
): number {
  const cls = className ?? sheet.className ?? sheet.class ?? "";
  return WEAPON_MASTERY_CLASSES[cls.toLowerCase()] ?? 0;
}

/**
 * Check if a character has mastery with a specific weapon.
 *
 * If the character sheet has an explicit `weaponMasteries` array, checks against that.
 * Otherwise, falls back to checking if the class grants Weapon Mastery and the
 * weapon count is sufficient (auto-grants mastery for all equipped weapons as a
 * simplification until explicit weapon mastery selection is implemented).
 */
export function hasWeaponMastery(
  sheet: WeaponMasterySheet,
  weaponName: string,
  className?: string,
): boolean {
  // Check explicit weapon mastery list on sheet
  const masteries = sheet.weaponMasteries;
  if (Array.isArray(masteries)) {
    return masteries.some(
      (m) => m.toLowerCase() === weaponName.toLowerCase(),
    );
  }

  // Fall back: if the class grants Weapon Mastery, auto-grant for all weapons
  // (simplification until explicit weapon selection UI is implemented)
  return hasWeaponMasteryFeature(sheet, className);
}

/**
 * Resolve the effective mastery property for a weapon in a character's hands.
 *
 * Returns undefined if:
 * - The weapon has no mastery property
 * - The character doesn't have Weapon Mastery for this weapon
 *
 * @param weaponName - Weapon name to look up
 * @param sheet - Character sheet
 * @param className - Optional class name override
 * @param explicitMastery - Optional explicit mastery override (from weapon data)
 */
export function resolveWeaponMastery(
  weaponName: string,
  sheet: WeaponMasterySheet,
  className?: string,
  explicitMastery?: string,
): WeaponMasteryProperty | undefined {
  if (!hasWeaponMastery(sheet, weaponName, className)) {
    return undefined;
  }

  // Use explicit mastery from weapon data if provided
  if (explicitMastery) {
    const lower = explicitMastery.toLowerCase();
    if (isWeaponMasteryProperty(lower)) {
      return lower;
    }
  }

  // Fall back to standard map
  return getWeaponMastery(weaponName);
}

/**
 * Type guard for WeaponMasteryProperty.
 */
export function isWeaponMasteryProperty(value: string): value is WeaponMasteryProperty {
  return ["cleave", "graze", "nick", "push", "sap", "slow", "topple", "vex"].includes(value);
}
