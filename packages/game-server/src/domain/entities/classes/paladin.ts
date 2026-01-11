import type { ResourcePool } from "../combat/resource-pool.js";
import { spendResource } from "../combat/resource-pool.js";
import type { CharacterClassDefinition } from "./class-definition.js";

export interface ChannelDivinityState {
  pool: ResourcePool;
}

export interface LayOnHandsState {
  pool: ResourcePool;
}

export function layOnHandsPoolForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error(`Invalid level: ${level}`);
  }

  return 5 * level;
}

export function createLayOnHandsState(level: number): LayOnHandsState {
  const max = layOnHandsPoolForLevel(level);
  return { pool: { name: "layOnHands", current: max, max } };
}

export function spendLayOnHands(state: LayOnHandsState, amount: number): LayOnHandsState {
  return { pool: spendResource(state.pool, amount) };
}

export function resetLayOnHandsOnLongRest(level: number, state: LayOnHandsState): LayOnHandsState {
  const max = layOnHandsPoolForLevel(level);
  return { pool: { name: state.pool.name, current: max, max } };
}

export function channelDivinityUsesForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error(`Invalid level: ${level}`);
  }

  // Channel Divinity is gained at level 3 for paladins.
  if (level < 3) return 0;
  if (level < 7) return 1;
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

export const Paladin: CharacterClassDefinition = {
  id: "paladin",
  name: "Paladin",
  hitDie: 10,
  proficiencies: {
    savingThrows: ["wisdom", "charisma"],
  },
  resourcesAtLevel: (level) => {
    const pools: ResourcePool[] = [];
    pools.push(createLayOnHandsState(level).pool);

    const cd = createChannelDivinityState(level);
    if (cd.pool.max > 0) pools.push(cd.pool);

    return pools;
  },
};
