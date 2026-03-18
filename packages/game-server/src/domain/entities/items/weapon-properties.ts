/**
 * Standardized weapon property checking utilities.
 *
 * All code that checks weapon properties (finesse, light, heavy, thrown, etc.)
 * should use these helpers instead of ad-hoc `.includes()` / `.some()` patterns.
 * This ensures consistent case-insensitive matching and handles the various
 * property string formats (e.g., "Thrown (Range 20/60)").
 */

import type { WeaponProperty } from "./weapon-catalog.js";
import { lookupWeapon } from "./weapon-catalog.js";

/**
 * Check if a weapon (by name or property array) has a specific property.
 * Case-insensitive, handles embedded ranges like "Thrown (20/60)".
 *
 * @param properties - Property string array from character sheet, or weapon name
 * @param property - The property to check for
 */
export function hasProperty(
  properties: readonly string[] | string | undefined | null,
  property: WeaponProperty | string,
): boolean {
  if (!properties) return false;

  // If given a weapon name string, resolve from catalog
  if (typeof properties === "string") {
    const entry = lookupWeapon(properties);
    if (!entry) return false;
    return entry.properties.some(
      (p) => p.toLowerCase() === property.toLowerCase(),
    );
  }

  const needle = property.toLowerCase();
  return properties.some((p) => {
    const lower = p.toLowerCase();
    // Exact match
    if (lower === needle) return true;
    // Prefix match for properties with embedded data: "thrown (20/60)" starts with "thrown"
    if (lower.startsWith(needle + " ") || lower.startsWith(needle + "(")) return true;
    return false;
  });
}

/**
 * Check if a weapon is a finesse weapon.
 */
export function isFinesse(properties: readonly string[] | undefined): boolean {
  return hasProperty(properties, "finesse");
}

/**
 * Check if a weapon has the Light property (required for TWF).
 */
export function isLight(properties: readonly string[] | undefined): boolean {
  return hasProperty(properties, "light");
}

/**
 * Check if a weapon has the Heavy property.
 */
export function isHeavy(properties: readonly string[] | undefined): boolean {
  return hasProperty(properties, "heavy");
}

/**
 * Check if a weapon has the Thrown property.
 */
export function isThrown(properties: readonly string[] | undefined): boolean {
  return hasProperty(properties, "thrown");
}

/**
 * Check if a weapon has the Loading property.
 */
export function isLoading(properties: readonly string[] | undefined): boolean {
  return hasProperty(properties, "loading");
}

/**
 * Check if a weapon has the Reach property.
 */
export function isReach(properties: readonly string[] | undefined): boolean {
  return hasProperty(properties, "reach");
}

/**
 * Check if a weapon has the Versatile property.
 */
export function isVersatile(properties: readonly string[] | undefined): boolean {
  return hasProperty(properties, "versatile");
}

/**
 * Check if a weapon has the Two-Handed property.
 */
export function isTwoHanded(properties: readonly string[] | undefined): boolean {
  return hasProperty(properties, "two-handed");
}

/**
 * Check if a weapon uses ammunition.
 */
export function usesAmmunition(properties: readonly string[] | undefined): boolean {
  return hasProperty(properties, "ammunition");
}
