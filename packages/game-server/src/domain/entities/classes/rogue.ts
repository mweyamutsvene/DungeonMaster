import type { CharacterClassDefinition, ClassCapability, SubclassDefinition } from "./class-definition.js";
import type { ClassCombatTextProfile, AttackReactionDef, AttackReactionInput, DetectedAttackReaction } from "./combat-text-profile.js";
import { isFinesse } from "../items/weapon-properties.js";
import { UNCANNY_DODGE, SECOND_STORY_WORK, SUPREME_SNEAK } from "./feature-keys.js";
import { classHasFeature } from "./registry.js";

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

// ----- Subclasses -----

/** Thief subclass (D&D 5e 2024). */
export const ThiefSubclass: SubclassDefinition = {
  id: "thief",
  name: "Thief",
  classId: "rogue",
  features: {
    "fast-hands": 3,
    [SECOND_STORY_WORK]: 3,
    [SUPREME_SNEAK]: 9,
  },
};

export const Rogue: CharacterClassDefinition = {
  id: "rogue",
  name: "Rogue",
  hitDie: 8,
  proficiencies: {
    savingThrows: ["dexterity", "intelligence"],
  },
  features: {
    "sneak-attack": 1,
    "weapon-mastery": 1,
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
  subclasses: [ThiefSubclass],
};

/**
 * Rogue Combat Text Profile — profile-driven text parsing.
 *
 * Action mappings:
 * - "cunning-action" → bonus action, Dash/Disengage/Hide as bonus action
 *
 * Attack reactions:
 * - Uncanny Dodge (level 5+) → halves damage from an attack you can see
 */

// ----- Attack Reaction: Uncanny Dodge -----

/**
 * Uncanny Dodge reaction detection (Rogue level 5+).
 * D&D 5e 2024: When an attacker you can see hits you with an attack,
 * you can use your reaction to halve the incoming damage.
 * Uses reaction; no resource cost.
 */
const UNCANNY_DODGE_REACTION: AttackReactionDef = {
  reactionType: "uncanny_dodge",
  classId: "rogue",
  detect(input: AttackReactionInput): DetectedAttackReaction | null {
    if (!input.hasReaction || !input.isCharacter) return null;
    if (!classHasFeature(input.className, UNCANNY_DODGE, input.level)) return null;

    return {
      reactionType: "uncanny_dodge",
      context: {
        attackerId: input.attackerId,
        attackRoll: input.attackRoll,
      },
    };
  },
};

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
  attackReactions: [UNCANNY_DODGE_REACTION],
};
