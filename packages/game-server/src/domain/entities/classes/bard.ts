import type { ResourcePool } from "../combat/resource-pool.js";
import { spendResource } from "../combat/resource-pool.js";
import type { CharacterClassDefinition, ClassCapability } from "./class-definition.js";
import type { ClassCombatTextProfile } from "./combat-text-profile.js";
import { JACK_OF_ALL_TRADES, FONT_OF_INSPIRATION, COUNTERCHARM } from "./feature-keys.js";

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

export const Bard: CharacterClassDefinition = {
  id: "bard",
  name: "Bard",
  hitDie: 8,
  proficiencies: {
    savingThrows: ["dexterity", "charisma"],
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
  // Requires CHA mod; caller can use createBardicInspirationState instead.
  resourcePoolFactory: (level, abilityModifiers) => {
    const chaMod = abilityModifiers?.["charisma"];
    if (chaMod === undefined) {
      throw new Error("charismaModifier is required to initialize bard resource pools");
    }
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
        const chaMod = abilityModifiers?.["charisma"];
        if (chaMod === undefined) {
          throw new Error("charismaModifier is required to refresh bardicInspiration");
        }
        return bardicInspirationUsesForLevel(level, chaMod);
      },
    },
  ],
};

export const BARD_COMBAT_TEXT_PROFILE: ClassCombatTextProfile = {
  classId: "bard",
  actionMappings: [
    { keyword: "bardic-inspiration", normalizedPatterns: [/bardicinspiration|usebardicinspiration|inspire/], abilityId: "class:bard:bardic-inspiration", category: "bonusAction" },
  ],
  attackEnhancements: [],
};
