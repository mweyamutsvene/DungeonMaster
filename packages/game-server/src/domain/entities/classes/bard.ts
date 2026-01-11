import type { ResourcePool } from "../combat/resource-pool.js";
import { spendResource } from "../combat/resource-pool.js";
import type { CharacterClassDefinition } from "./class-definition.js";

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
  // Requires CHA mod; caller can use createBardicInspirationState instead.
};
