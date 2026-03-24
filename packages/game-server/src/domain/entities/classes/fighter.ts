import type { ResourcePool } from "../combat/resource-pool.js";
import { spendResource } from "../combat/resource-pool.js";
import type { CharacterClassDefinition, ClassCapability } from "./class-definition.js";
import type { ClassCombatTextProfile } from "./combat-text-profile.js";

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
  features: {
    "second-wind": 1,
    "action-surge": 2,
    "extra-attack": 5,
    "two-extra-attacks": 11,
    "three-extra-attacks": 20,
  },
  resourcesAtLevel: (level) => {
    const pools: ResourcePool[] = [];
    const actionSurge = createActionSurgeState(level);
    if (actionSurge.pool.max > 0) pools.push(actionSurge.pool);

    const secondWind = createSecondWindState(level);
    if (secondWind.pool.max > 0) pools.push(secondWind.pool);

    return pools;
  },
  resourcePoolFactory: (level) => {
    const pools: ResourcePool[] = [];
    const actionSurge = createActionSurgeState(level);
    if (actionSurge.pool.max > 0) pools.push(actionSurge.pool);

    const secondWind = createSecondWindState(level);
    if (secondWind.pool.max > 0) pools.push(secondWind.pool);

    return pools;
  },
  restRefreshPolicy: [
    { poolKey: "actionSurge", refreshOn: "both", computeMax: (level) => actionSurgeUsesForLevel(level) },
    { poolKey: "secondWind", refreshOn: "both", computeMax: (level) => secondWindUsesForLevel(level) },
  ],
  capabilitiesForLevel: (level): readonly ClassCapability[] => {
    const caps: ClassCapability[] = [
      { name: "Second Wind", economy: "bonusAction", cost: "1 use/short rest", effect: "Regain 1d10 + Fighter level HP", abilityId: "class:fighter:second-wind", resourceCost: { pool: "secondWind", amount: 1 } },
    ];
    if (level >= 2) {
      caps.push({ name: "Action Surge", economy: "free", cost: "1 use/short rest", effect: "Take one additional action this turn", abilityId: "class:fighter:action-surge", resourceCost: { pool: "actionSurge", amount: 1 } });
    }
    if (level >= 5) {
      caps.push({ name: "Extra Attack", economy: "action", requires: "Attack action", effect: "Attack twice per Attack action" });
    }
    if (level >= 9) {
      caps.push({ name: "Indomitable", economy: "free", cost: "1 use/long rest", effect: "Reroll a failed saving throw" });
    }
    return caps;
  },
};

/** Combat text profile — maps text patterns to Fighter ability IDs. */
export const FIGHTER_COMBAT_TEXT_PROFILE: ClassCombatTextProfile = {
  classId: "fighter",
  actionMappings: [
    { keyword: "action-surge", normalizedPatterns: [/actionsurge|useactionsurge/], abilityId: "class:fighter:action-surge", category: "classAction" },
    { keyword: "second-wind", normalizedPatterns: [/secondwind|usesecondwind/], abilityId: "class:fighter:second-wind", category: "bonusAction" },
  ],
  attackEnhancements: [],
};
