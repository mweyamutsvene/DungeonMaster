import type { ResourcePool } from "../combat/resource-pool.js";
import { spendResource } from "../combat/resource-pool.js";
import type { CharacterClassDefinition, ClassCapability } from "./class-definition.js";
import type { ClassCombatTextProfile } from "./combat-text-profile.js";

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
    armor: [],
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
  capabilitiesForLevel: (level): readonly ClassCapability[] => {
    const caps: ClassCapability[] = [
      { name: "Spellcasting", economy: "action", effect: "Cast sorcerer spells using CHA" },
    ];
    if (level >= 2) {
      caps.push({ name: "Sorcery Points", economy: "free", cost: `${sorceryPointsForLevel(level)} points/long rest`, effect: "Fuel Metamagic options and convert to/from spell slots" });
      caps.push({ name: "Metamagic", economy: "free", cost: "Sorcery Points", effect: "Modify spells with Metamagic options (Quickened, Twinned, etc.)" });
    }
    return caps;
  },
  restRefreshPolicy: [
    { poolKey: "sorceryPoints", refreshOn: "long", computeMax: (level) => sorceryPointsForLevel(level) },
  ],
};

export const SORCERER_COMBAT_TEXT_PROFILE: ClassCombatTextProfile = {
  classId: "sorcerer",
  actionMappings: [
    { keyword: "quickened-spell", normalizedPatterns: [/quickenedspell|quickenspell|quicken/], abilityId: "class:sorcerer:quickened-spell", category: "bonusAction" },
    { keyword: "twinned-spell", normalizedPatterns: [/twinnedspell|twinspell|twin/], abilityId: "class:sorcerer:twinned-spell", category: "classAction" },
  ],
  attackEnhancements: [],
};
