import type { ResourcePool } from "../combat/resource-pool.js";
import { spendResource } from "../combat/resource-pool.js";
import type { CharacterClassDefinition } from "./class-definition.js";

export interface SorceryPointsState {
  pool: ResourcePool;
}

export function sorceryPointsForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error(`Invalid level: ${level}`);
  }

  // Sorcery points start at level 2 and equal sorcerer level.
  return level < 2 ? 0 : level;
}

export function createSorceryPointsState(level: number): SorceryPointsState {
  const max = sorceryPointsForLevel(level);
  return { pool: { name: "sorceryPoints", current: max, max } };
}

export function spendSorceryPoints(
  state: SorceryPointsState,
  amount: number,
): SorceryPointsState {
  return { pool: spendResource(state.pool, amount) };
}

export function resetSorceryPointsOnLongRest(
  level: number,
  state: SorceryPointsState,
): SorceryPointsState {
  const max = sorceryPointsForLevel(level);
  return { pool: { name: state.pool.name, current: max, max } };
}

export const Sorcerer: CharacterClassDefinition = {
  id: "sorcerer",
  name: "Sorcerer",
  hitDie: 6,
  proficiencies: {
    savingThrows: ["constitution", "charisma"],
  },
  features: {
    "spellcasting": 1,
    "sorcery-points": 2,
    "metamagic": 2,
  },
  resourcesAtLevel: (level) => {
    const sp = createSorceryPointsState(level);
    return sp.pool.max > 0 ? [sp.pool] : [];
  },
  resourcePoolFactory: (level) => {
    const sp = createSorceryPointsState(level);
    return sp.pool.max > 0 ? [sp.pool] : [];
  },
  restRefreshPolicy: [
    { poolKey: "sorceryPoints", refreshOn: "long", computeMax: (level) => sorceryPointsForLevel(level) },
  ],
};
