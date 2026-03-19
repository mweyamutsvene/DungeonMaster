import type { ResourcePool } from "../combat/resource-pool.js";
import { spendResource } from "../combat/resource-pool.js";
import type { CharacterClassDefinition, ClassCapability } from "./class-definition.js";
import type { ClassCombatTextProfile } from "./combat-text-profile.js";

export interface RageState {
  pool: ResourcePool;
  active: boolean;
}

export function rageUsesForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error(`Invalid level: ${level}`);
  }

  if (level <= 2) return 2;
  if (level <= 5) return 3;
  if (level <= 11) return 4;
  if (level <= 16) return 5;
  return 6;
}

export function createRageState(level: number): RageState {
  const max = rageUsesForLevel(level);
  return { pool: { name: "rage", current: max, max }, active: false };
}

export function startRage(state: RageState): RageState {
  if (state.active) {
    return state;
  }
  return { ...state, pool: spendResource(state.pool, 1), active: true };
}

export function endRage(state: RageState): RageState {
  if (!state.active) {
    return state;
  }
  return { ...state, active: false };
}

export function resetRageOnLongRest(level: number, state: RageState): RageState {
  const max = rageUsesForLevel(level);
  return { pool: { name: state.pool.name, current: max, max }, active: false };
}

/**
 * Barbarian Unarmored Defense AC (D&D 5e 2024).
 * AC = 10 + DEX modifier + CON modifier (no armor, shield allowed).
 */
export function barbarianUnarmoredDefenseAC(dexMod: number, conMod: number): number {
  return 10 + dexMod + conMod;
}

/**
 * Danger Sense (Barbarian level 2+).
 * Advantage on DEX saving throws against effects you can see.
 */
export function hasDangerSense(level: number): boolean {
  return level >= 2;
}

/**
 * Feral Instinct (Barbarian level 7+).
 * Advantage on initiative rolls; can't be surprised if not incapacitated.
 */
export function hasFeralInstinct(level: number): boolean {
  return level >= 7;
}

/**
 * Determines whether Rage should end at the start of the Barbarian's turn.
 * Rage ends if (didn't attack AND didn't take damage since last turn), OR if unconscious.
 */
export function shouldRageEnd(attacked: boolean, tookDamage: boolean, isUnconscious: boolean): boolean {
  return (!attacked && !tookDamage) || isUnconscious;
}

/**
 * Checks if Danger Sense is negated by conditions.
 * Danger Sense doesn't work if the Barbarian is Blinded, Deafened, or Incapacitated.
 */
export function isDangerSenseNegated(conditions: string[]): boolean {
  const negating = ["blinded", "deafened", "incapacitated"];
  return conditions.some(c => negating.includes(c.toLowerCase()));
}

/**
 * Rage Damage bonus by Barbarian level (D&D 5e 2024).
 * +2 at levels 1-8, +3 at levels 9-15, +4 at levels 16+.
 */
export function rageDamageBonusForLevel(level: number): number {
  if (level >= 16) return 4;
  if (level >= 9) return 3;
  return 2;
}

/**
 * Barbarian Combat Text Profile — profile-driven text parsing.
 *
 * Action mappings:
 * - "rage" → bonus action, activates Rage
 * - "reckless-attack" → classAction (free), sets reckless flag for the turn
 */
export const BARBARIAN_COMBAT_TEXT_PROFILE: ClassCombatTextProfile = {
  classId: "barbarian",
  actionMappings: [
    {
      keyword: "rage",
      normalizedPatterns: [/^rage$|^userage$|^enterrage$/],
      abilityId: "class:barbarian:rage",
      category: "bonusAction",
    },
    {
      keyword: "reckless-attack",
      normalizedPatterns: [/recklessattack|reckless$/],
      abilityId: "class:barbarian:reckless-attack",
      category: "classAction",
    },
  ],
  attackEnhancements: [],
};

export const Barbarian: CharacterClassDefinition = {
  id: "barbarian",
  name: "Barbarian",
  hitDie: 12,
  proficiencies: {
    savingThrows: ["strength", "constitution"],
  },
  resourcesAtLevel: (level) => [createRageState(level).pool],
  capabilitiesForLevel: (level): readonly ClassCapability[] => {
    const caps: ClassCapability[] = [
      { name: "Unarmored Defense", economy: "free", effect: "AC = 10 + DEX mod + CON mod (no armor)" },
      { name: "Rage", economy: "bonusAction", cost: "1 use/long rest", effect: "Resistance to B/P/S, bonus melee damage, advantage on STR checks/saves", abilityId: "class:barbarian:rage", resourceCost: { pool: "rage", amount: 1 } },
    ];
    if (level >= 2) {
      caps.push({ name: "Danger Sense", economy: "free", effect: "Advantage on DEX saving throws against effects you can see" });
      caps.push({ name: "Reckless Attack", economy: "free", requires: "First attack on your turn", effect: "Gain advantage on melee STR attacks this turn; attacks against you have advantage", abilityId: "class:barbarian:reckless-attack" });
    }
    if (level >= 5) {
      caps.push({ name: "Extra Attack", economy: "action", requires: "Attack action", effect: "Attack twice per Attack action" });
    }
    if (level >= 7) {
      caps.push({ name: "Feral Instinct", economy: "free", effect: "Advantage on initiative; can't be surprised unless incapacitated" });
    }
    return caps;
  },
};
