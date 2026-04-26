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

export type OffhandEligibilityReason =
  | "OK"
  | "MISSING_WEAPON"
  | "ATTACK_ACTION_REQUIRED"
  | "NOT_LIGHT";

export interface OffhandAttackEligibilityInput {
  mainWeapon: WeaponProperties | null | undefined;
  offhandWeapon: WeaponProperties | null | undefined;
  hasDualWielderFeat?: boolean;
  hasTakenAttackActionThisTurn?: boolean;
  hasNickMastery?: boolean;
  nickUsedThisTurn?: boolean;
  hasTwoWeaponFightingStyle?: boolean;
}

export interface OffhandAttackEligibility {
  allowed: boolean;
  reason: OffhandEligibilityReason;
  requiresBonusAction: boolean;
  usesNick: boolean;
  offhandAddsAbilityModifier: boolean;
}

function hasProperty(weapon: WeaponProperties | null | undefined, property: string): boolean {
  if (!weapon?.properties) return false;
  const normalized = property.toLowerCase();
  return weapon.properties.some((p) => p.toLowerCase() === normalized);
}

/**
 * Evaluate deterministic off-hand eligibility and runtime policy.
 */
export function evaluateOffhandAttackEligibility(
  input: OffhandAttackEligibilityInput,
): OffhandAttackEligibility {
  const hasTakenAttackActionThisTurn = input.hasTakenAttackActionThisTurn ?? true;
  if (!hasTakenAttackActionThisTurn) {
    return {
      allowed: false,
      reason: "ATTACK_ACTION_REQUIRED",
      requiresBonusAction: true,
      usesNick: false,
      offhandAddsAbilityModifier: false,
    };
  }

  if (!input.mainWeapon || !input.offhandWeapon) {
    return {
      allowed: false,
      reason: "MISSING_WEAPON",
      requiresBonusAction: true,
      usesNick: false,
      offhandAddsAbilityModifier: false,
    };
  }

  const hasDualWielderFeat = input.hasDualWielderFeat ?? false;
  const mainIsLight = hasProperty(input.mainWeapon, "light");
  const offhandIsLight = hasProperty(input.offhandWeapon, "light");
  if (!hasDualWielderFeat && (!mainIsLight || !offhandIsLight)) {
    return {
      allowed: false,
      reason: "NOT_LIGHT",
      requiresBonusAction: true,
      usesNick: false,
      offhandAddsAbilityModifier: false,
    };
  }

  const usesNick = (input.hasNickMastery ?? false) && !(input.nickUsedThisTurn ?? false);
  return {
    allowed: true,
    reason: "OK",
    requiresBonusAction: !usesNick,
    usesNick,
    offhandAddsAbilityModifier: input.hasTwoWeaponFightingStyle ?? false,
  };
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
  return evaluateOffhandAttackEligibility({
    mainWeapon,
    offhandWeapon,
    hasDualWielderFeat,
    hasTakenAttackActionThisTurn: true,
  }).allowed;
}

/**
 * Compute the ability modifier bonus added to off-hand attack damage.
 *
 * D&D 5e 2024: The off-hand attack uses the attack's normal ability modifier.
 * The Two-Weapon Fighting style only matters for enabling positive bonus damage;
 * negative modifiers still apply.
 */
export function computeOffhandDamageModifier(
  abilityModifier: number,
  hasTwoWeaponFightingStyle: boolean,
): number {
  if (abilityModifier <= 0) return abilityModifier;
  return hasTwoWeaponFightingStyle ? abilityModifier : 0;
}
