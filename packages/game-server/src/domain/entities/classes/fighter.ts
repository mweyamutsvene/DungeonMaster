import type { ResourcePool } from "../combat/resource-pool.js";
import { spendResource } from "../combat/resource-pool.js";
import type { CharacterClassDefinition } from "./class-definition.js";

export interface ActionSurgeState {
  pool: ResourcePool;
}

export interface SecondWindState {
  pool: ResourcePool;
}

export function actionSurgeUsesForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error(`Invalid level: ${level}`);
  }

  if (level < 2) return 0;
  if (level < 17) return 1;
  return 2;
}

export function createActionSurgeState(level: number): ActionSurgeState {
  const max = actionSurgeUsesForLevel(level);
  return { pool: { name: "actionSurge", current: max, max } };
}

export function spendActionSurge(state: ActionSurgeState, amount: number): ActionSurgeState {
  return { pool: spendResource(state.pool, amount) };
}

export function resetActionSurgeOnShortRest(
  level: number,
  state: ActionSurgeState,
): ActionSurgeState {
  const max = actionSurgeUsesForLevel(level);
  return { pool: { name: state.pool.name, current: max, max } };
}

export function secondWindUsesForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error(`Invalid level: ${level}`);
  }

  // Second Wind is gained at level 1 and remains 1 use.
  return 1;
}

export function createSecondWindState(level: number): SecondWindState {
  const max = secondWindUsesForLevel(level);
  return { pool: { name: "secondWind", current: max, max } };
}

export function spendSecondWind(state: SecondWindState, amount: number): SecondWindState {
  return { pool: spendResource(state.pool, amount) };
}

export function resetSecondWindOnShortRest(level: number, state: SecondWindState): SecondWindState {
  const max = secondWindUsesForLevel(level);
  return { pool: { name: state.pool.name, current: max, max } };
}

export const Fighter: CharacterClassDefinition = {
  id: "fighter",
  name: "Fighter",
  hitDie: 10,
  proficiencies: {
    savingThrows: ["strength", "constitution"],
  },
  resourcesAtLevel: (level) => {
    const pools: ResourcePool[] = [];
    const actionSurge = createActionSurgeState(level);
    if (actionSurge.pool.max > 0) pools.push(actionSurge.pool);

    const secondWind = createSecondWindState(level);
    if (secondWind.pool.max > 0) pools.push(secondWind.pool);

    return pools;
  },
};
