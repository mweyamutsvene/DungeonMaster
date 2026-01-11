/**
 * D&D 5e Bonus Action Mechanics
 *
 * Rules:
 * - You can take only ONE bonus action per turn
 * - You can only take a bonus action if a feature, spell, or ability grants you one
 * - Bonus actions are separate from your main action
 * - Common examples:
 *   - Two-weapon fighting (off-hand attack)
 *   - Cunning Action (rogue: Dash, Disengage, or Hide as bonus action)
 *   - Healing Word spell
 *   - Spiritual Weapon attack
 *   - Misty Step spell
 */

export interface BonusActionState {
  /** Whether bonus action has been used this turn */
  bonusActionUsed: boolean;
}

/**
 * Create initial bonus action state.
 */
export function createBonusActionState(): BonusActionState {
  return { bonusActionUsed: false };
}

/**
 * Check if a combatant has their bonus action available.
 */
export function hasBonusActionAvailable(state: BonusActionState): boolean {
  return !state.bonusActionUsed;
}

/**
 * Mark bonus action as used.
 */
export function useBonusAction(state: BonusActionState): BonusActionState {
  return { bonusActionUsed: true };
}

/**
 * Reset bonus action at start of turn.
 */
export function resetBonusAction(): BonusActionState {
  return { bonusActionUsed: false };
}

/**
 * Common bonus action types in D&D 5e.
 */
export type BonusActionType =
  | "OffHandAttack"      // Two-weapon fighting
  | "CunningAction"      // Rogue feature (Dash/Disengage/Hide)
  | "HealingWord"        // Spell
  | "SpiritualWeapon"    // Spell attack
  | "MistyStep"          // Teleport spell
  | "ShieldMaster"       // Feat: shove after attack
  | "PolearmMaster"      // Feat: butt end attack
  | "CrossbowExpert"     // Feat: hand crossbow attack
  | "FlurryOfBlows"      // Monk feature
  | "PatientDefense"     // Monk feature (Dodge as bonus)
  | "StepOfTheWind"      // Monk feature (Dash/Disengage as bonus)
  | "SecondWind"         // Fighter feature
  | "ActionSurge"        // Fighter feature (bonus action in some interpretations)
  | "Custom";            // Other class/feat bonus actions

/**
 * Check if a specific action can be used as a bonus action.
 * This is a simplified check - in a full implementation, this would verify
 * the creature has the required class feature, feat, or spell.
 */
export function canUseBonusAction(
  state: BonusActionState,
  actionType: BonusActionType,
  hasRequiredFeature: boolean = true,
): { allowed: boolean; reason?: string } {
  if (!hasRequiredFeature) {
    return { allowed: false, reason: "Missing required feature, spell, or ability" };
  }

  if (!hasBonusActionAvailable(state)) {
    return { allowed: false, reason: "Bonus action already used this turn" };
  }

  return { allowed: true };
}

/**
 * Validate two-weapon fighting bonus action requirements.
 * Both weapons must be light, and off-hand attack doesn't add ability modifier to damage
 * (unless you have the Dual Wielder feat or Two-Weapon Fighting style).
 */
export interface TwoWeaponFightingCheck {
  mainHandWeaponIsLight: boolean;
  offHandWeaponIsLight: boolean;
  addAbilityModifierToDamage: boolean; // Requires Fighting Style or feat
}

export function canMakeOffHandAttack(
  check: TwoWeaponFightingCheck,
): { allowed: boolean; reason?: string } {
  if (!check.mainHandWeaponIsLight) {
    return { allowed: false, reason: "Main-hand weapon must be light" };
  }

  if (!check.offHandWeaponIsLight) {
    return { allowed: false, reason: "Off-hand weapon must be light" };
  }

  return { allowed: true };
}
