import type { ResourcePool } from "../combat/resource-pool.js";
import { spendResource } from "../combat/resource-pool.js";
import type { CharacterClassDefinition } from "./class-definition.js";

export interface ChannelDivinityState {
  pool: ResourcePool;
}

export function channelDivinityUsesForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error(`Invalid level: ${level}`);
  }

  // Channel Divinity is gained at level 2.
  if (level < 2) return 0;
  if (level < 6) return 1;
  if (level < 18) return 2;
  return 3;
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
