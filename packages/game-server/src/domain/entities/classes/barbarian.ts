import type { ResourcePool } from "../combat/resource-pool.js";
import { spendResource } from "../combat/resource-pool.js";
import type { CharacterClassDefinition } from "./class-definition.js";
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
};
