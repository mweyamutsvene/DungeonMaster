import type { ResourcePool } from "../combat/resource-pool.js";
import { spendResource } from "../combat/resource-pool.js";
import type { CharacterClassDefinition } from "./class-definition.js";

export interface ArcaneRecoveryState {
  pool: ResourcePool;
}

export function arcaneRecoveryUsesForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error(`Invalid level: ${level}`);
  }

  // Arcane Recovery gained at level 1; once per day.
  return 1;
}

export function arcaneRecoveryMaxRecoveredSlotLevels(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error(`Invalid level: ${level}`);
  }

  // 5e: recover slots totaling up to half your wizard level (rounded up).
  return Math.ceil(level / 2);
}

export function createArcaneRecoveryState(level: number): ArcaneRecoveryState {
  const max = arcaneRecoveryUsesForLevel(level);
  return { pool: { name: "arcaneRecovery", current: max, max } };
}

export function spendArcaneRecovery(
  state: ArcaneRecoveryState,
  amount: number,
): ArcaneRecoveryState {
  return { pool: spendResource(state.pool, amount) };
}

export function resetArcaneRecoveryOnLongRest(
  level: number,
  state: ArcaneRecoveryState,
): ArcaneRecoveryState {
  const max = arcaneRecoveryUsesForLevel(level);
  return { pool: { name: state.pool.name, current: max, max } };
}

export const Wizard: CharacterClassDefinition = {
  id: "wizard",
  name: "Wizard",
  hitDie: 6,
  proficiencies: {
    savingThrows: ["intelligence", "wisdom"],
  },
  resourcesAtLevel: (level) => [createArcaneRecoveryState(level).pool],
};
