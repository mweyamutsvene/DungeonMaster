/**
 * Two-Weapon Fighting — Domain Logic
 *
 * D&D 5e 2024 base rules for two-weapon fighting (off-hand attacks).
 * These are the pure rules — action economy and orchestration live in the
 * OffhandAttackExecutor (application layer).
 */

export interface WeaponProperties {
  properties?: readonly string[];
}

/**
 * Check if a creature can make an off-hand attack with the given weapons.
 *
 * D&D 5e 2024: Both weapons must have the Light property, unless the
 * creature has the Dual Wielder feat (which removes the Light requirement).
 */
export function canMakeOffhandAttack(
  mainWeapon: WeaponProperties | null | undefined,
  offhandWeapon: WeaponProperties | null | undefined,
  hasDualWielderFeat: boolean = false,
): boolean {
  if (!mainWeapon || !offhandWeapon) return false;
  if (hasDualWielderFeat) return true;

  const mainIsLight = mainWeapon.properties?.some(
    p => p.toLowerCase() === "light",
  ) ?? false;
  const offIsLight = offhandWeapon.properties?.some(
    p => p.toLowerCase() === "light",
  ) ?? false;

  return mainIsLight && offIsLight;
}

/**
 * Compute the ability modifier bonus added to off-hand attack damage.
 *
 * D&D 5e 2024: Off-hand attacks do NOT add the ability modifier to damage,
 * unless the creature has the Two-Weapon Fighting style.
 */
export function computeOffhandDamageModifier(
  abilityModifier: number,
  hasTwoWeaponFightingStyle: boolean,
): number {
  return hasTwoWeaponFightingStyle ? abilityModifier : 0;
}
