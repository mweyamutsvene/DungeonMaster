import type { ResourcePool } from "../combat/resource-pool.js";
import { spendResource } from "../combat/resource-pool.js";
import type { CharacterClassDefinition } from "./class-definition.js";
import type { ClassCombatTextProfile } from "./combat-text-profile.js";

export interface ChannelDivinityState {
  pool: ResourcePool;
}

/**
 * Channel Divinity uses per level (D&D 5e 2024 rules).
 * Level 2: 2 uses, Level 6: 3 uses, Level 18: 4 uses.
 */
export function channelDivinityUsesForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error(`Invalid level: ${level}`);
  }

  // D&D 5e 2024: Channel Divinity gained at level 2.
  if (level < 2) return 0;
  if (level < 6) return 2;
  if (level < 18) return 3;
  return 4;
}

export function createChannelDivinityState(level: number): ChannelDivinityState {
  const max = channelDivinityUsesForLevel(level);
  return { pool: { name: "channelDivinity", current: max, max } };
}

export function spendChannelDivinity(
  state: ChannelDivinityState,
  amount: number,
): ChannelDivinityState {
  return { pool: spendResource(state.pool, amount) };
}

export function resetChannelDivinityOnShortRest(
  level: number,
  state: ChannelDivinityState,
): ChannelDivinityState {
  const max = channelDivinityUsesForLevel(level);
  return { pool: { name: state.pool.name, current: max, max } };
}

/**
 * Cleric combat text profile.
 * - Turn Undead: classAction that uses Channel Divinity (costs regular action)
 */
export const CLERIC_COMBAT_TEXT_PROFILE: ClassCombatTextProfile = {
  classId: "cleric",
  actionMappings: [
    {
      keyword: "turn-undead",
      abilityId: "class:cleric:turn-undead",
      category: "classAction" as const,
      normalizedPatterns: [/turnundead/, /turningundead/],
    },
  ],
  attackEnhancements: [],
};

export const Cleric: CharacterClassDefinition = {
  id: "cleric",
  name: "Cleric",
  hitDie: 8,
  proficiencies: {
    savingThrows: ["wisdom", "charisma"],
  },
  resourcesAtLevel: (level) => {
    const cd = createChannelDivinityState(level);
    return cd.pool.max > 0 ? [cd.pool] : [];
  },
};
