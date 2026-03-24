import type { ResourcePool } from "../combat/resource-pool.js";
import { spendResource } from "../combat/resource-pool.js";
import type { CharacterClassDefinition } from "./class-definition.js";
import type {
  ClassCombatTextProfile,
  DamageReactionDef, DamageReactionInput, DetectedDamageReaction,
} from "./combat-text-profile.js";
import { proficiencyBonusForLevel } from "../../rules/proficiency.js";

export type PactSlotLevel = 1 | 2 | 3 | 4 | 5;

export interface PactMagicSlots {
  slotLevel: PactSlotLevel;
  slots: number;
}

export interface PactMagicState {
  pool: ResourcePool;
  slotLevel: PactSlotLevel;
}

export function pactMagicSlotsForLevel(level: number): PactMagicSlots {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error(`Invalid level: ${level}`);
  }

  // 5e Pact Magic (simplified, excludes Mystic Arcanum):
  // slots refresh on short rest; slot level caps at 5.
  if (level === 1) return { slotLevel: 1, slots: 1 };
  if (level === 2) return { slotLevel: 1, slots: 2 };
  if (level <= 4) return { slotLevel: 2, slots: 2 };
  if (level <= 6) return { slotLevel: 3, slots: 2 };
  if (level <= 8) return { slotLevel: 4, slots: 2 };
  if (level <= 10) return { slotLevel: 5, slots: 2 };
  if (level <= 16) return { slotLevel: 5, slots: 3 };
  return { slotLevel: 5, slots: 4 };
}

export function createPactMagicState(level: number): PactMagicState {
  const { slotLevel, slots } = pactMagicSlotsForLevel(level);
  return { pool: { name: "pactMagic", current: slots, max: slots }, slotLevel };
}

export function spendPactMagicSlot(state: PactMagicState, amount: number): PactMagicState {
  return { ...state, pool: spendResource(state.pool, amount) };
}

export function resetPactMagicOnShortRest(level: number, state: PactMagicState): PactMagicState {
  const { slotLevel, slots } = pactMagicSlotsForLevel(level);
  return {
    pool: { name: state.pool.name, current: slots, max: slots },
    slotLevel,
  };
}

export const Warlock: CharacterClassDefinition = {
  id: "warlock",
  name: "Warlock",
  hitDie: 8,
  proficiencies: {
    savingThrows: ["wisdom", "charisma"],
  },
  features: {
    "pact-magic": 1,
  },
  resourcesAtLevel: (level) => [createPactMagicState(level).pool],
  resourcePoolFactory: (level) => [createPactMagicState(level).pool],
  restRefreshPolicy: [
    { poolKey: "pactMagic", refreshOn: "both", computeMax: (level) => pactMagicSlotsForLevel(level).slots },
  ],
};

// ----- Damage Reaction: Hellish Rebuke -----

/**
 * Hellish Rebuke reaction detection (D&D 5e 2024).
 * When you are damaged by a creature you can see within 60 feet, use your reaction to
 * deal 2d10 fire damage to that creature (DEX save for half).
 * Spell save DC = 8 + proficiency + CHA modifier.
 * Requires a level 1+ spell slot (or Pact Magic slot) + reaction.
 */
const HELLISH_REBUKE_REACTION: DamageReactionDef = {
  reactionType: "hellish_rebuke",
  classId: "warlock",
  detect(input: DamageReactionInput): DetectedDamageReaction | null {
    if (!input.hasReaction || !input.isCharacter) return null;

    // Check hasHellishRebukePrepared flag
    if (input.resources.hasHellishRebukePrepared !== true) return null;

    // Check level 1+ spell slot OR pact magic slot
    const pools = Array.isArray(input.resources.resourcePools) ? input.resources.resourcePools as any[] : [];
    const hasSpellSlot = pools.some((p: any) => p.name === "spellSlot_1" && (p as any).current > 0);
    const hasPactSlot = pools.some((p: any) => p.name === "pactMagic" && (p as any).current > 0);
    if (!hasSpellSlot && !hasPactSlot) return null;

    // Spell save DC = 8 + proficiency + CHA modifier
    const chaScore = input.abilityScores.charisma ?? 10;
    const chaMod = Math.floor((chaScore - 10) / 2);
    const profBonus = proficiencyBonusForLevel(input.level);
    const spellSaveDC = 8 + profBonus + chaMod;

    return {
      reactionType: "hellish_rebuke",
      context: {
        attackerId: input.attackerId,
        damageAmount: input.damageAmount,
        spellSaveDC,
        chaMod,
        profBonus,
        // Use pactMagic if available (warlock's primary), else spellSlot_1
        slotToSpend: hasPactSlot ? "pactMagic" : "spellSlot_1",
      },
    };
  },
};

/** Combat text profile for Warlock — Hellish Rebuke damage reaction. */
export const WARLOCK_COMBAT_TEXT_PROFILE: ClassCombatTextProfile = {
  classId: "warlock",
  actionMappings: [],
  attackEnhancements: [],
  damageReactions: [HELLISH_REBUKE_REACTION],
};
