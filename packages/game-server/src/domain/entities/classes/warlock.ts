import type { ResourcePool } from "../combat/resource-pool.js";
import { spendResource } from "../combat/resource-pool.js";
import type { CharacterClassDefinition } from "./class-definition.js";

export type PactSlotLevel = 1 | 2 | 3 | 4 | 5;

export interface PactMagicSlots {
  slotLevel: PactSlotLevel;
  slots: number;
}

export interface PactMagicState {
  pool: ResourcePool;
  slotLevel: PactSlotLevel;
}

export function pactMagicSlotsForLevel(level: number): PactMagicSlots {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error(`Invalid level: ${level}`);
  }

  // 5e Pact Magic (simplified, excludes Mystic Arcanum):
  // slots refresh on short rest; slot level caps at 5.
  if (level === 1) return { slotLevel: 1, slots: 1 };
  if (level === 2) return { slotLevel: 1, slots: 2 };
  if (level <= 4) return { slotLevel: 2, slots: 2 };
  if (level <= 6) return { slotLevel: 3, slots: 2 };
  if (level <= 8) return { slotLevel: 4, slots: 2 };
  if (level <= 10) return { slotLevel: 5, slots: 2 };
  if (level <= 16) return { slotLevel: 5, slots: 3 };
  return { slotLevel: 5, slots: 4 };
}

export function createPactMagicState(level: number): PactMagicState {
  const { slotLevel, slots } = pactMagicSlotsForLevel(level);
  return { pool: { name: "pactMagic", current: slots, max: slots }, slotLevel };
}

export function spendPactMagicSlot(state: PactMagicState, amount: number): PactMagicState {
  return { ...state, pool: spendResource(state.pool, amount) };
}

export function resetPactMagicOnShortRest(level: number, state: PactMagicState): PactMagicState {
  const { slotLevel, slots } = pactMagicSlotsForLevel(level);
  return {
    pool: { name: state.pool.name, current: slots, max: slots },
    slotLevel,
  };
}

export const Warlock: CharacterClassDefinition = {
  id: "warlock",
  name: "Warlock",
  hitDie: 8,
  proficiencies: {
    savingThrows: ["wisdom", "charisma"],
  },
  resourcesAtLevel: (level) => [createPactMagicState(level).pool],
};
