/**
 * Protection & Interception Fighting Style — Domain Logic
 *
 * D&D 5e 2024:
 *  - Protection: When a creature you can see attacks a target other than you
 *    that is within 5 feet of you, you can use your reaction to impose
 *    disadvantage on the attack roll. You must be wielding a shield.
 *  - Interception: When a creature you can see hits a target within 5 feet
 *    of you with an attack, you can use your reaction to reduce the damage
 *    by 1d10 + your proficiency bonus (minimum 0). You must be wielding a
 *    shield or a simple/martial weapon.
 */

import type { Position } from "../rules/movement.js";
import { calculateDistance } from "../rules/movement.js";

/**
 * Condition ids (lowercase) that prevent a would-be protector from using
 * reactions like Protection or Interception.
 */
export const PROTECTOR_DISABLING_CONDITIONS: readonly string[] = [
  "incapacitated",
  "unconscious",
  "stunned",
  "paralyzed",
  "petrified",
];

function hasDisablingCondition(activeConditions: readonly string[] | null | undefined): boolean {
  if (!activeConditions || activeConditions.length === 0) return false;
  for (const c of activeConditions) {
    if (PROTECTOR_DISABLING_CONDITIONS.includes(c.toLowerCase())) return true;
  }
  return false;
}

export interface ProtectionEligibility {
  /** Whether the protector has the Protection fighting style. */
  hasProtectionStyle: boolean;
  /** Whether the protector has a reaction available this round. */
  hasReactionAvailable: boolean;
  /** Whether the protector is wielding a shield. */
  isWieldingShield: boolean;
  /**
   * Active condition ids (lowercase) on the protector. If any of the
   * disabling conditions (incapacitated/unconscious/stunned/paralyzed/petrified)
   * is present, the protector cannot use the reaction.
   */
  activeConditions?: readonly string[];
}

/**
 * Check if a creature can use the Protection fighting style reaction.
 *
 * Requirements (all must be true):
 * 1. Protector has the Protection fighting style
 * 2. Protector is within 5 feet of the target being attacked
 * 3. Protector has a reaction available
 * 4. Protector is wielding a shield
 * 5. Protector is not Incapacitated/Unconscious/Stunned/Paralyzed/Petrified
 * 6. The attacker is targeting someone other than the protector (caller responsibility)
 */
export function canUseProtection(
  protector: ProtectionEligibility,
  protectorPosition: Position | null | undefined,
  targetPosition: Position | null | undefined,
): boolean {
  if (!protector.hasProtectionStyle) return false;
  if (!protector.hasReactionAvailable) return false;
  if (!protector.isWieldingShield) return false;
  if (hasDisablingCondition(protector.activeConditions)) return false;
  if (!protectorPosition || !targetPosition) return false;

  const distanceFeet = calculateDistance(protectorPosition, targetPosition);
  return distanceFeet <= 5;
}

export interface InterceptionEligibility {
  /** Whether the protector has the Interception fighting style. */
  hasInterceptionStyle: boolean;
  /** Whether the protector has a reaction available this round. */
  hasReactionAvailable: boolean;
  /** Whether the protector is wielding a shield. */
  isWieldingShield: boolean;
  /** Whether the protector is wielding a simple or martial weapon. */
  isWieldingWeapon: boolean;
  /**
   * Active condition ids (lowercase) on the protector. If any of the
   * disabling conditions is present, the protector cannot use the reaction.
   */
  activeConditions?: readonly string[];
}

/**
 * Check if a creature can use the Interception fighting style reaction.
 *
 * Requirements (all must be true):
 * 1. Protector has the Interception fighting style
 * 2. Protector is within 5 feet of the target being attacked
 * 3. Protector has a reaction available
 * 4. Protector is wielding a shield OR a simple/martial weapon
 * 5. Protector is not Incapacitated/Unconscious/Stunned/Paralyzed/Petrified
 */
export function canUseInterception(
  protector: InterceptionEligibility,
  protectorPosition: Position | null | undefined,
  targetPosition: Position | null | undefined,
): boolean {
  if (!protector.hasInterceptionStyle) return false;
  if (!protector.hasReactionAvailable) return false;
  if (!protector.isWieldingShield && !protector.isWieldingWeapon) return false;
  if (hasDisablingCondition(protector.activeConditions)) return false;
  if (!protectorPosition || !targetPosition) return false;

  const distanceFeet = calculateDistance(protectorPosition, targetPosition);
  return distanceFeet <= 5;
}
