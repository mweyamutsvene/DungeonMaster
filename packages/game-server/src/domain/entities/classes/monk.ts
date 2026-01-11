import type { ResourcePool } from "../combat/resource-pool.js";
import { spendResource } from "../combat/resource-pool.js";
import type { CharacterClassDefinition } from "./class-definition.js";

export interface KiState {
  pool: ResourcePool;
}

export function kiPointsForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error(`Invalid level: ${level}`);
  }

  // Ki starts at level 2 and equals monk level.
  return level < 2 ? 0 : level;
}

export function createKiState(level: number): KiState {
  const max = kiPointsForLevel(level);
  return { pool: { name: "ki", current: max, max } };
}

export function spendKi(state: KiState, amount: number): KiState {
  return { pool: spendResource(state.pool, amount) };
}

export function resetKiOnShortRest(level: number, state: KiState): KiState {
  const max = kiPointsForLevel(level);
  return { pool: { name: state.pool.name, current: max, max } };
}

export const Monk: CharacterClassDefinition = {
  id: "monk",
  name: "Monk",
  hitDie: 8,
  proficiencies: {
    savingThrows: ["strength", "dexterity"],
  },
  resourcesAtLevel: (level) => {
    const ki = createKiState(level);
    return ki.pool.max > 0 ? [ki.pool] : [];
  },
};
