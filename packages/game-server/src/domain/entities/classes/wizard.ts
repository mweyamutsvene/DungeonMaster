import type { ResourcePool } from "../combat/resource-pool.js";
import { spendResource } from "../combat/resource-pool.js";
import type { CharacterClassDefinition, ClassCapability, SubclassDefinition } from "./class-definition.js";
import type {
  ClassCombatTextProfile,
  AttackReactionDef, AttackReactionInput, DetectedAttackReaction,
  DamageReactionDef, DamageReactionInput, DetectedDamageReaction,
  SpellReactionDef, SpellReactionInput, DetectedSpellReaction,
} from "./combat-text-profile.js";
import { proficiencyBonusForLevel } from "../../rules/proficiency.js";
import { computeSpellSaveDC } from "../../rules/spell-casting.js";
import { SCULPT_SPELLS, EVOCATION_SAVANT } from "./feature-keys.js";

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

// ----- Subclasses -----

/**
 * School of Evocation subclass (D&D 5e 2024).
 * Shell definition — executors for Sculpt Spells (exclude allies from evocation AoE)
 * and Evocation Savant (half-cost spellbook copy) are deferred to Phase 3.
 */
export const SchoolOfEvocationSubclass: SubclassDefinition = {
  id: "school-of-evocation",
  name: "School of Evocation",
  classId: "wizard",
  features: {
    [SCULPT_SPELLS]: 3,
    [EVOCATION_SAVANT]: 3,
  },
};

export const Wizard: CharacterClassDefinition = {
  id: "wizard",
  name: "Wizard",
  hitDie: 6,
  proficiencies: {
    savingThrows: ["intelligence", "wisdom"],
    armor: [],
  },
  features: {
    "spellcasting": 1,
    "arcane-recovery": 1,
  },
  resourcesAtLevel: (level) => [createArcaneRecoveryState(level).pool],
  restRefreshPolicy: [
    { poolKey: "arcaneRecovery", refreshOn: "long", computeMax: (level) => arcaneRecoveryUsesForLevel(level) },
  ],
  capabilitiesForLevel: (level): readonly ClassCapability[] => {
    const caps: ClassCapability[] = [
      { name: "Spellcasting", economy: "action", effect: "Cast wizard spells using INT" },
      { name: "Arcane Recovery", economy: "free", cost: "1 use/long rest", effect: `Recover spell slots totaling up to ${arcaneRecoveryMaxRecoveredSlotLevels(level)} levels`, abilityId: "class:wizard:arcane-recovery", resourceCost: { pool: "arcaneRecovery", amount: 1 } },
    ];
    return caps;
  },
  subclasses: [SchoolOfEvocationSubclass],
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

    // Check level 1+ spell slot or Pact Magic availability
    const pools = input.resources.resourcePools ?? [];
    const hasSpellSlot = pools.some(p => p.name === "spellSlot_1" && p.current > 0);
    const hasPactSlot = pools.some(p => p.name === "pactMagic" && p.current > 0);
    if (!hasSpellSlot && !hasPactSlot) return null;

    const newAC = input.targetAC + 5;
    return {
      reactionType: "shield",
      context: {
        attackerId: input.attackerId,
        attackRoll: input.attackRoll,
        currentAC: input.targetAC,
        newAC,
        slotToSpend: hasSpellSlot ? "spellSlot_1" : "pactMagic",
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

    // Check level 3+ spell slot or Pact Magic availability
    const pools = input.resources.resourcePools ?? [];
    let bestSlotLevel = 0;
    let slotToSpend: string | undefined;
    for (const p of pools) {
      const match = p.name.match(/^spellSlot_(\d+)$/);
      if (match && p.current > 0) {
        const slotLevel = parseInt(match[1], 10);
        if (slotLevel >= 3 && slotLevel > bestSlotLevel) {
          bestSlotLevel = slotLevel;
          slotToSpend = `spellSlot_${slotLevel}`;
        }
      }
    }
    // Warlock Pact Magic fallback: use pact slot if no standard slot >= 3 qualifies
    if (bestSlotLevel === 0) {
      const pactSlotLevel = typeof input.resources.pactSlotLevel === "number" ? input.resources.pactSlotLevel : undefined;
      const hasPactSlot = pools.some(p => p.name === "pactMagic" && p.current > 0);
      if (hasPactSlot && pactSlotLevel !== undefined && pactSlotLevel >= 3) {
        bestSlotLevel = pactSlotLevel;
        slotToSpend = "pactMagic";
      }
    }
    if (bestSlotLevel === 0) return null;

    const intScore = input.abilityScores.intelligence ?? 10;
    const intMod = Math.floor((intScore - 10) / 2);
    const profBonus = proficiencyBonusForLevel(input.level);
    const spellSaveDC = computeSpellSaveDC({ spellcastingAbility: 'intelligence', abilityScores: input.abilityScores, level: input.level });

    return {
      reactionType: "counterspell",
      context: {
        casterId: input.casterId,
        spellName: input.spellName,
        spellLevel: input.spellLevel,
        counterspellerLevel: input.level,
        spellSaveDC,
        bestSlotLevel,
        slotToSpend,
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

    // Check level 1+ spell slot or Pact Magic availability
    const pools = input.resources.resourcePools ?? [];
    const hasSpellSlot = pools.some(p => p.name === "spellSlot_1" && p.current > 0);
    const hasPactSlot = pools.some(p => p.name === "pactMagic" && p.current > 0);
    if (!hasSpellSlot && !hasPactSlot) return null;

    return {
      reactionType: "absorb_elements",
      context: {
        attackerId: input.attackerId,
        damageType: input.damageType,
        damageAmount: input.damageAmount,
        healBack: Math.floor(input.damageAmount / 2),
        slotToSpend: hasSpellSlot ? "spellSlot_1" : "pactMagic",
      },
    };
  },
};

// ----- Spell Reaction: Silvery Barbs (attack roll success) -----

/**
 * Silvery Barbs attack reaction detection (D&D 5e 2024).
 * When a creature within 60 feet succeeds on an attack roll, ability check, or saving throw,
 * you can use your reaction to force a reroll, using the lower result. Then grant one creature
 * advantage on the next d20 roll within 1 minute.
 * Requires a level 1+ spell slot + reaction + hasSilveryBarbsPrepared flag.
 *
 * TODO: CO-L4 — Full reaction flow integration (reroll resolution, advantage grant).
 * Currently only detects eligibility; resolution requires a new reaction handler in
 * TwoPhaseActionService to process the forced reroll and apply the advantage buff.
 */
const SILVERY_BARBS_REACTION: AttackReactionDef = {
  reactionType: "silvery_barbs",
  classId: "wizard",
  detect(input: AttackReactionInput): DetectedAttackReaction | null {
    if (!input.hasReaction || !input.isCharacter) return null;

    // Check hasSilveryBarbsPrepared flag (set by buildCombatResources)
    if (input.resources.hasSilveryBarbsPrepared !== true) return null;

    // Silvery Barbs only triggers when the attack *hits* (succeeds)
    if (input.attackRoll < input.targetAC) return null;

    // Check level 1+ spell slot or Pact Magic availability
    const pools = input.resources.resourcePools ?? [];
    const hasSpellSlot = pools.some(p => p.name === "spellSlot_1" && p.current > 0);
    const hasPactSlot = pools.some(p => p.name === "pactMagic" && p.current > 0);
    if (!hasSpellSlot && !hasPactSlot) return null;

    return {
      reactionType: "silvery_barbs",
      context: {
        attackerId: input.attackerId,
        attackRoll: input.attackRoll,
        targetAC: input.targetAC,
        slotToSpend: hasSpellSlot ? "spellSlot_1" : "pactMagic",
      },
    };
  },
};

/** Combat text profile for Wizard — attack reactions, damage reactions, spell reactions. */
export const WIZARD_COMBAT_TEXT_PROFILE: ClassCombatTextProfile = {
  classId: "wizard",
  actionMappings: [],
  attackEnhancements: [],
  attackReactions: [SHIELD_REACTION, SILVERY_BARBS_REACTION],
  damageReactions: [ABSORB_ELEMENTS_REACTION],
  spellReactions: [COUNTERSPELL_REACTION],
};
