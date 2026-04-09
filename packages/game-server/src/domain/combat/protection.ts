/**
 * Protection Fighting Style — Domain Logic
 *
 * D&D 5e 2024: When a creature you can see attacks a target other than you
 * that is within 5 feet of you, you can use your reaction to impose
 * disadvantage on the attack roll. You must be wielding a shield.
 */

import type { Position } from "../rules/movement.js";
import { calculateDistance } from "../rules/movement.js";

export interface ProtectionEligibility {
  /** Whether the protector has the Protection fighting style. */
  hasProtectionStyle: boolean;
  /** Whether the protector has a reaction available this round. */
  hasReactionAvailable: boolean;
  /** Whether the protector is wielding a shield. */
  isWieldingShield: boolean;
}

/**
 * Check if a creature can use the Protection fighting style reaction.
 *
 * Requirements (all must be true):
 * 1. Protector has the Protection fighting style
 * 2. Protector is within 5 feet of the target being attacked
 * 3. Protector has a reaction available
 * 4. Protector is wielding a shield
 * 5. The attacker is targeting someone other than the protector (caller responsibility)
 *
 * @param protector - Eligibility flags for the protector
 * @param protectorPosition - Position of the protector on the map
 * @param targetPosition - Position of the creature being attacked
 * @returns true if the protector can use Protection
 */
export function canUseProtection(
  protector: ProtectionEligibility,
  protectorPosition: Position | null | undefined,
  targetPosition: Position | null | undefined,
): boolean {
  if (!protector.hasProtectionStyle) return false;
  if (!protector.hasReactionAvailable) return false;
  if (!protector.isWieldingShield) return false;
  if (!protectorPosition || !targetPosition) return false;

  const distanceFeet = calculateDistance(protectorPosition, targetPosition);
  return distanceFeet <= 5;
}
