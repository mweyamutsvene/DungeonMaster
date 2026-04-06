import type { ResourcePool } from "../combat/resource-pool.js";
import { spendResource } from "../combat/resource-pool.js";
import type { CharacterClassDefinition } from "./class-definition.js";
import type {
  ClassCombatTextProfile,
  AttackReactionDef, AttackReactionInput, DetectedAttackReaction,
  DamageReactionDef, DamageReactionInput, DetectedDamageReaction,
  SpellReactionDef, SpellReactionInput, DetectedSpellReaction,
} from "./combat-text-profile.js";
import { proficiencyBonusForLevel } from "../../rules/proficiency.js";

export interface ArcaneRecoveryState {
  pool: ResourcePool;
}

export function arcaneRecoveryUsesForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error(`Invalid level: ${level}`);
  }

  // Arcane Recovery gained at level 1; once per day.
  return 1;
}

export function arcaneRecoveryMaxRecoveredSlotLevels(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error(`Invalid level: ${level}`);
  }

  // 5e: recover slots totaling up to half your wizard level (rounded up).
  return Math.ceil(level / 2);
}

export function createArcaneRecoveryState(level: number): ArcaneRecoveryState {
  const max = arcaneRecoveryUsesForLevel(level);
  return { pool: { name: "arcaneRecovery", current: max, max } };
}

export function spendArcaneRecovery(
  state: ArcaneRecoveryState,
  amount: number,
): ArcaneRecoveryState {
  return { pool: spendResource(state.pool, amount) };
}

export function resetArcaneRecoveryOnLongRest(
  level: number,
  state: ArcaneRecoveryState,
): ArcaneRecoveryState {
  const max = arcaneRecoveryUsesForLevel(level);
  return { pool: { name: state.pool.name, current: max, max } };
}

export const Wizard: CharacterClassDefinition = {
  id: "wizard",
  name: "Wizard",
  hitDie: 6,
  proficiencies: {
    savingThrows: ["intelligence", "wisdom"],
  },
  features: {
    "spellcasting": 1,
    "arcane-recovery": 1,
  },
  resourcesAtLevel: (level) => [createArcaneRecoveryState(level).pool],
  resourcePoolFactory: (level) => [createArcaneRecoveryState(level).pool],
  restRefreshPolicy: [
    { poolKey: "arcaneRecovery", refreshOn: "long", computeMax: (level) => arcaneRecoveryUsesForLevel(level) },
  ],
};

// ----- Attack Reaction: Shield Spell -----

/**
 * Shield spell reaction detection.
 * Available to any character with `hasShieldPrepared` flag and a level 1 spell slot.
 * Not class-gated — any character with Shield prepared can use it.
 */
const SHIELD_REACTION: AttackReactionDef = {
  reactionType: "shield",
  classId: "wizard", // Primary class, but detection checks resources, not class
  detect(input: AttackReactionInput): DetectedAttackReaction | null {
    if (!input.hasReaction || !input.isCharacter) return null;

    // Check hasShieldPrepared flag (set by buildCombatResources)
    if (input.resources.hasShieldPrepared !== true) return null;

    // Check level 1 spell slot availability
    const pools = Array.isArray(input.resources.resourcePools) ? input.resources.resourcePools as any[] : [];
    const slotPool = pools.find((p: any) => p.name === "spellSlot_1");
    if (!slotPool || slotPool.current <= 0) return null;

    const newAC = input.targetAC + 5;
    return {
      reactionType: "shield",
      context: {
        attackerId: input.attackerId,
        attackRoll: input.attackRoll,
        currentAC: input.targetAC,
        newAC,
      },
    };
  },
};

// ----- Spell Reaction: Counterspell -----

/**
 * Counterspell reaction detection (D&D 5e 2024).
 * When you see a creature within 60 feet casting a spell, you can use your reaction
 * to attempt to interrupt it. The target makes a CON save against your spell save DC.
 * Requires a level 3+ spell slot + reaction.
 */
const COUNTERSPELL_REACTION: SpellReactionDef = {
  reactionType: "counterspell",
  classId: "wizard",
  detect(input: SpellReactionInput): DetectedSpellReaction | null {
    if (!input.hasReaction) return null;

    // Check hasCounterspellPrepared flag
    if (input.resources.hasCounterspellPrepared !== true) return null;

    // Must be within 60 feet
    if (input.distance > 60) return null;

    // Check level 3+ spell slot availability
    const pools = Array.isArray(input.resources.resourcePools) ? input.resources.resourcePools as any[] : [];
    let bestSlotLevel = 0;
    for (const p of pools) {
      const match = typeof (p as any).name === "string" ? (p as any).name.match(/^spellSlot_(\d+)$/) : null;
      if (match && (p as any).current > 0) {
        const slotLevel = parseInt(match[1], 10);
        if (slotLevel >= 3 && slotLevel > bestSlotLevel) bestSlotLevel = slotLevel;
      }
    }
    if (bestSlotLevel === 0) return null;

    // Wizard spell save DC = 8 + proficiency + INT modifier
    const intScore = input.abilityScores.intelligence ?? 10;
    const intMod = Math.floor((intScore - 10) / 2);
    const profBonus = proficiencyBonusForLevel(input.level);
    const spellSaveDC = 8 + profBonus + intMod;

    return {
      reactionType: "counterspell",
      context: {
        casterId: input.casterId,
        spellName: input.spellName,
        spellLevel: input.spellLevel,
        counterspellerLevel: input.level,
        spellSaveDC,
        bestSlotLevel,
        intMod,
        profBonus,
      },
    };
  },
};

// ----- Damage Reaction: Absorb Elements -----

/** Elemental damage types that trigger Absorb Elements. */
const ABSORB_ELEMENTS_TYPES = new Set(["acid", "cold", "fire", "lightning", "thunder"]);

/**
 * Absorb Elements reaction detection (D&D 5e 2024).
 * When you take acid, cold, fire, lightning, or thunder damage, use your reaction to:
 * - Gain resistance to the triggering damage type until start of your next turn
 *   (retroactively halving the triggering damage)
 * - Deal an extra 1d6 of that damage type on your next melee attack
 * Requires a level 1+ spell slot + reaction.
 */
const ABSORB_ELEMENTS_REACTION: DamageReactionDef = {
  reactionType: "absorb_elements",
  classId: "wizard",
  detect(input: DamageReactionInput): DetectedDamageReaction | null {
    if (!input.hasReaction || !input.isCharacter) return null;

    // Check hasAbsorbElementsPrepared flag
    if (input.resources.hasAbsorbElementsPrepared !== true) return null;

    // Must be an eligible elemental damage type
    if (!ABSORB_ELEMENTS_TYPES.has(input.damageType.toLowerCase())) return null;

    // Check level 1+ spell slot availability
    const pools = Array.isArray(input.resources.resourcePools) ? input.resources.resourcePools as any[] : [];
    const slotPool = pools.find((p: any) => p.name === "spellSlot_1" && (p as any).current > 0);
    if (!slotPool) return null;

    return {
      reactionType: "absorb_elements",
      context: {
        attackerId: input.attackerId,
        damageType: input.damageType,
        damageAmount: input.damageAmount,
        healBack: Math.floor(input.damageAmount / 2),
        slotToSpend: "spellSlot_1",
      },
    };
  },
};

/** Combat text profile for Wizard — attack reactions, damage reactions, spell reactions. */
export const WIZARD_COMBAT_TEXT_PROFILE: ClassCombatTextProfile = {
  classId: "wizard",
  actionMappings: [],
  attackEnhancements: [],
  attackReactions: [SHIELD_REACTION],
  damageReactions: [ABSORB_ELEMENTS_REACTION],
  spellReactions: [COUNTERSPELL_REACTION],
};
