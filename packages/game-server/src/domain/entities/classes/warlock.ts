import type { ResourcePool } from "../combat/resource-pool.js";
import { spendResource } from "../combat/resource-pool.js";
import type { CharacterClassDefinition, ClassCapability, SubclassDefinition } from "./class-definition.js";
import type {
  ClassCombatTextProfile,
  DamageReactionDef, DamageReactionInput, DetectedDamageReaction,
} from "./combat-text-profile.js";
import {
  ELDRITCH_INVOCATIONS, PACT_BOON, MYSTIC_ARCANUM_6, MYSTIC_ARCANUM_7, MYSTIC_ARCANUM_8, MYSTIC_ARCANUM_9, ELDRITCH_MASTER,
  DARK_ONES_BLESSING, FIEND_EXPANDED_SPELLS,
} from "./feature-keys.js";
import { proficiencyBonusForLevel } from "../../rules/proficiency.js";
import { computeSpellSaveDC } from "../../rules/spell-casting.js";

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

// ----- Subclasses -----

/**
 * The Fiend subclass (D&D 5e 2024).
 * Shell definition — executors for Dark One's Blessing (temp HP on kill) and
 * Fiend-expanded spells are deferred to Phase 3.
 */
export const TheFiendSubclass: SubclassDefinition = {
  id: "the-fiend",
  name: "The Fiend",
  classId: "warlock",
  features: {
    [DARK_ONES_BLESSING]: 3,
    [FIEND_EXPANDED_SPELLS]: 3,
  },
};

export const Warlock: CharacterClassDefinition = {
  id: "warlock",
  name: "Warlock",
  hitDie: 8,
  proficiencies: {
    savingThrows: ["wisdom", "charisma"],
    armor: ["light"],
  },
  features: {
    "spellcasting": 1,
    "pact-magic": 1,
    [ELDRITCH_INVOCATIONS]: 2,
    [PACT_BOON]: 3,
    [MYSTIC_ARCANUM_6]: 11,
    [MYSTIC_ARCANUM_7]: 13,
    [MYSTIC_ARCANUM_8]: 15,
    [MYSTIC_ARCANUM_9]: 17,
    [ELDRITCH_MASTER]: 20,
  },
  capabilitiesForLevel: (level): readonly ClassCapability[] => {
    const caps: ClassCapability[] = [];
    caps.push({ name: "Pact Magic", economy: "action", cost: "Pact Magic slots", effect: "Cast warlock spells using Pact Magic slots (recharge on short rest)" });
    if (level >= 2) {
      caps.push({ name: "Eldritch Invocations", economy: "free", effect: "Eldritch Invocations grant passive or activated abilities" });
    }
    if (level >= 3) {
      caps.push({ name: "Pact Boon", economy: "free", effect: "Gain Pact of the Blade/Chain/Tome boon" });
    }
    return caps;
  },
  resourcesAtLevel: (level) => [createPactMagicState(level).pool],
  restRefreshPolicy: [
    { poolKey: "pactMagic", refreshOn: "both", computeMax: (level) => pactMagicSlotsForLevel(level).slots },
  ],
  subclasses: [TheFiendSubclass],
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
    const pools = input.resources.resourcePools ?? [];
    const hasSpellSlot = pools.some(p => p.name === "spellSlot_1" && p.current > 0);
    const hasPactSlot = pools.some(p => p.name === "pactMagic" && p.current > 0);
    if (!hasSpellSlot && !hasPactSlot) return null;

    const chaScore = input.abilityScores.charisma ?? 10;
    const chaMod = Math.floor((chaScore - 10) / 2);
    const profBonus = proficiencyBonusForLevel(input.level);
    const spellSaveDC = computeSpellSaveDC({ spellcastingAbility: 'charisma', abilityScores: input.abilityScores, level: input.level });

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
