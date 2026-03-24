import type { CharacterClassDefinition, ClassCapability } from "./class-definition.js";
import type { ClassCombatTextProfile } from "./combat-text-profile.js";
import { isFinesse } from "../items/weapon-properties.js";

export function sneakAttackDiceForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error(`Invalid level: ${level}`);
  }

  // Sneak Attack starts at 1d6 and increases by 1d6 at odd levels.
  // 1:1, 3:2, 5:3, ... 19:10
  return Math.floor((level + 1) / 2);
}

/**
 * Check eligibility for Sneak Attack (D&D 5e 2024).
 * Requirements:
 * - Attacker must be a Rogue
 * - Weapon must have the Finesse property OR be Ranged
 * - Must have advantage on the attack roll, OR an ally within 5ft of the target
 * - Not already used Sneak Attack this turn (once per turn)
 */
export function isSneakAttackEligible(params: {
  className: string;
  weaponKind: "melee" | "ranged";
  weaponProperties?: string[];
  hasAdvantage: boolean;
  allyAdjacentToTarget: boolean;
  sneakAttackUsedThisTurn: boolean;
}): boolean {
  // Must be a Rogue
  if (params.className.toLowerCase() !== "rogue") return false;

  // Must not have used sneak attack already this turn
  if (params.sneakAttackUsedThisTurn) return false;

  // Weapon must be finesse or ranged
  const finesse = isFinesse(params.weaponProperties);
  const isRanged = params.weaponKind === "ranged";
  if (!finesse && !isRanged) return false;

  // Must have advantage OR ally within 5ft of target
  return params.hasAdvantage || params.allyAdjacentToTarget;
}

export const Rogue: CharacterClassDefinition = {
  id: "rogue",
  name: "Rogue",
  hitDie: 8,
  proficiencies: {
    savingThrows: ["dexterity", "intelligence"],
  },
  features: {
    "sneak-attack": 1,
    "cunning-action": 2,
    "uncanny-dodge": 5,
    "evasion": 7,
  },
  capabilitiesForLevel: (level): readonly ClassCapability[] => {
    const caps: ClassCapability[] = [
      { name: "Sneak Attack", economy: "free", requires: "Finesse/ranged weapon + advantage or ally adjacent", effect: `${sneakAttackDiceForLevel(level)}d6 extra damage (once/turn)` },
    ];
    if (level >= 2) {
      caps.push({ name: "Cunning Action", economy: "bonusAction", effect: "Dash, Disengage, or Hide as bonus action", abilityId: "class:rogue:cunning-action" });
    }
    if (level >= 5) {
      caps.push({ name: "Uncanny Dodge", economy: "reaction", requires: "Hit by an attack you can see", effect: "Halve the damage", abilityId: "class:rogue:uncanny-dodge" });
    }
    if (level >= 7) {
      caps.push({ name: "Evasion", economy: "free", requires: "DEX save for half damage", effect: "Success = no damage, failure = half damage" });
    }
    return caps;
  },
};

/**
 * Rogue Combat Text Profile — profile-driven text parsing.
 *
 * Action mappings:
 * - "cunning-action" → bonus action, Dash/Disengage/Hide as bonus action
 */
export const ROGUE_COMBAT_TEXT_PROFILE: ClassCombatTextProfile = {
  classId: "rogue",
  actionMappings: [
    {
      keyword: "cunning-action",
      normalizedPatterns: [/cunningaction/, /cunningdash/, /cunningdisengage/, /cunninghide/],
      abilityId: "class:rogue:cunning-action",
      category: "bonusAction",
    },
  ],
  attackEnhancements: [],
};
