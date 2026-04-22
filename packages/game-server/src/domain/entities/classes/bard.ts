import type { ResourcePool } from "../combat/resource-pool.js";
import { spendResource } from "../combat/resource-pool.js";
import type { CharacterClassDefinition, ClassCapability, SubclassDefinition } from "./class-definition.js";
import type {
  ClassCombatTextProfile,
  AttackReactionDef,
  AttackReactionInput,
  DetectedAttackReaction,
} from "./combat-text-profile.js";
import {
  JACK_OF_ALL_TRADES, FONT_OF_INSPIRATION, COUNTERCHARM,
  CUTTING_WORDS, ADDITIONAL_MAGICAL_SECRETS, BONUS_PROFICIENCIES,
} from "./feature-keys.js";

export type BardicInspirationDie = 6 | 8 | 10 | 12;

export interface BardicInspirationState {
  pool: ResourcePool;
  die: BardicInspirationDie;
}

export function bardicInspirationDieForLevel(level: number): BardicInspirationDie {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error(`Invalid level: ${level}`);
  }

  if (level < 5) return 6;
  if (level < 10) return 8;
  if (level < 15) return 10;
  return 12;
}

export function bardicInspirationUsesForLevel(
  level: number,
  charismaModifier: number,
): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error(`Invalid level: ${level}`);
  }
  if (!Number.isInteger(charismaModifier)) {
    throw new Error("Charisma modifier must be an integer");
  }

  // 5e: uses equal CHA mod (minimum 1).
  return Math.max(1, charismaModifier);
}

export function createBardicInspirationState(
  level: number,
  charismaModifier: number,
): BardicInspirationState {
  const max = bardicInspirationUsesForLevel(level, charismaModifier);
  const die = bardicInspirationDieForLevel(level);
  return { pool: { name: "bardicInspiration", current: max, max }, die };
}

export function spendBardicInspiration(
  state: BardicInspirationState,
  amount: number,
): BardicInspirationState {
  return { ...state, pool: spendResource(state.pool, amount) };
}

export function resetBardicInspirationOnRest(
  level: number,
  charismaModifier: number,
  state: BardicInspirationState,
  rest: "short" | "long",
): BardicInspirationState {
  // Font of Inspiration at level 5: regain on short rest.
  const refreshOnShortRest = level >= 5;
  if (rest === "short" && !refreshOnShortRest) {
    return state;
  }

  const max = bardicInspirationUsesForLevel(level, charismaModifier);
  const die = bardicInspirationDieForLevel(level);
  return { pool: { name: state.pool.name, current: max, max }, die };
}

// ----- Subclasses -----

/**
 * College of Lore subclass (D&D 5e 2024).
 * Shell definition — executor for Cutting Words reaction (subtract Bardic
 * Inspiration die from attack/check/damage) is deferred to Phase 3.
 */
export const CollegeOfLoreSubclass: SubclassDefinition = {
  id: "college-of-lore",
  name: "College of Lore",
  classId: "bard",
  features: {
    [BONUS_PROFICIENCIES]: 3,
    [CUTTING_WORDS]: 3,
    [ADDITIONAL_MAGICAL_SECRETS]: 6,
  },
};

export const Bard: CharacterClassDefinition = {
  id: "bard",
  name: "Bard",
  hitDie: 8,
  proficiencies: {
    savingThrows: ["dexterity", "charisma"],
    armor: ["light"],
  },
  features: {
    "spellcasting": 1,
    "bardic-inspiration": 1,
    [JACK_OF_ALL_TRADES]: 2,
    [FONT_OF_INSPIRATION]: 5,
    [COUNTERCHARM]: 6,
  },
  resourcesAtLevel: (level, abilityModifiers) => {
    const chaMod = abilityModifiers?.charisma ?? 0;
    return [createBardicInspirationState(level, chaMod).pool];
  },
  capabilitiesForLevel: (level): readonly ClassCapability[] => {
    const caps: ClassCapability[] = [
      { name: "Spellcasting", economy: "action", effect: "Cast bard spells using CHA" },
      { name: "Bardic Inspiration", economy: "bonusAction", cost: "1 use", effect: `Grant ally a d${bardicInspirationDieForLevel(level)} to add to ability check, attack roll, or saving throw`, abilityId: "class:bard:bardic-inspiration", resourceCost: { pool: "bardicInspiration", amount: 1 } },
    ];
    if (level >= 2) {
      caps.push({ name: "Jack of All Trades", economy: "free", effect: "Add half proficiency bonus to ability checks without proficiency" });
    }
    if (level >= 5) {
      caps.push({ name: "Font of Inspiration", economy: "free", effect: "Bardic Inspiration recharges on short rest" });
    }
    if (level >= 6) {
      caps.push({ name: "Countercharm", economy: "action", effect: "Allies within 30ft advantage on saves vs frightened/charmed" });
    }
    return caps;
  },
  restRefreshPolicy: [
    {
      poolKey: "bardicInspiration",
      refreshOn: (rest, level) => rest === "long" || (rest === "short" && level >= 5),
      computeMax: (level, abilityModifiers) => {
        const chaMod = abilityModifiers?.["charisma"] ?? 0;
        return bardicInspirationUsesForLevel(level, chaMod);
      },
    },
  ],
  subclasses: [CollegeOfLoreSubclass],
};

// ----- Reactions -----

/**
 * Cutting Words (College of Lore L3 — D&D 5e 2024).
 *
 * Reaction: when a creature within 60 feet makes an attack roll, ability check,
 * or damage roll, the Bard spends one Bardic Inspiration use to subtract the BI
 * die from the roll. Currently wired for attack rolls; damage/check variants
 * can be added in follow-up work.
 */
const CUTTING_WORDS_REACTION: AttackReactionDef = {
  reactionType: "cutting_words",
  classId: "bard",
  detect(input: AttackReactionInput): DetectedAttackReaction | null {
    if (!input.hasReaction || !input.isCharacter) return null;
    if (input.resources.hasCuttingWords !== true) return null;

    const pools = input.resources.resourcePools ?? [];
    const bi = pools.find((p) => p.name === "bardicInspiration");
    if (!bi || bi.current <= 0) return null;

    const dieSize = bardicInspirationDieForLevel(Math.max(1, input.level));

    return {
      reactionType: "cutting_words",
      context: {
        attackerId: input.attackerId,
        attackRoll: input.attackRoll,
        currentAC: input.targetAC,
        dieSize,
      },
    };
  },
};

export const BARD_COMBAT_TEXT_PROFILE: ClassCombatTextProfile = {
  classId: "bard",
  actionMappings: [
    { keyword: "bardic-inspiration", normalizedPatterns: [/bardicinspiration|usebardicinspiration|inspire/], abilityId: "class:bard:bardic-inspiration", category: "bonusAction" },
  ],
  attackEnhancements: [],
  attackReactions: [CUTTING_WORDS_REACTION],
};
