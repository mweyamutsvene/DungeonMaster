import type { ResourcePool } from "../combat/resource-pool.js";
import { spendResource } from "../combat/resource-pool.js";
import type { CharacterClassDefinition, ClassCapability } from "./class-definition.js";
import type { ClassCombatTextProfile } from "./combat-text-profile.js";

export interface WildShapeState {
  pool: ResourcePool;
}

export function wildShapeUsesForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error(`Invalid level: ${level}`);
  }

  // Wild Shape gained at level 2; 2 uses.
  return level < 2 ? 0 : 2;
}

export function wildShapeMaxCRForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error(`Invalid level: ${level}`);
  }

  // 5e druid: max CR starts at 1/4, then 1/2 at 4, then 1 at 8.
  if (level < 2) return 0;
  if (level < 4) return 0.25;
  if (level < 8) return 0.5;
  return 1;
}

export function createWildShapeState(level: number): WildShapeState {
  const max = wildShapeUsesForLevel(level);
  return { pool: { name: "wildShape", current: max, max } };
}

export function spendWildShape(state: WildShapeState, amount: number): WildShapeState {
  return { pool: spendResource(state.pool, amount) };
}

export function resetWildShapeOnShortRest(level: number, state: WildShapeState): WildShapeState {
  const max = wildShapeUsesForLevel(level);
  return { pool: { name: state.pool.name, current: max, max } };
}

export const Druid: CharacterClassDefinition = {
  id: "druid",
  name: "Druid",
  hitDie: 8,
  proficiencies: {
    savingThrows: ["intelligence", "wisdom"],
    armor: ["light", "shield"],
  },
  features: {
    "spellcasting": 1,
    "wild-shape": 2,
  },
  resourcesAtLevel: (level) => {
    const ws = createWildShapeState(level);
    return ws.pool.max > 0 ? [ws.pool] : [];
  },
  resourcePoolFactory: (level) => {
    const ws = createWildShapeState(level);
    return ws.pool.max > 0 ? [ws.pool] : [];
  },
  capabilitiesForLevel: (level): readonly ClassCapability[] => {
    const caps: ClassCapability[] = [
      { name: "Spellcasting", economy: "action", effect: "Cast druid spells using WIS" },
    ];
    if (level >= 2) {
      const maxCR = wildShapeMaxCRForLevel(level);
      caps.push({
        name: "Wild Shape",
        economy: "bonusAction",
        cost: "1 use (2/short rest)",
        effect: `Transform into beast of CR ${maxCR} or lower`,
        abilityId: "class:druid:wild-shape",
        resourceCost: { pool: "wildShape", amount: 1 },
      });
    }
    return caps;
  },
  restRefreshPolicy: [
    { poolKey: "wildShape", refreshOn: "both", computeMax: (level) => wildShapeUsesForLevel(level) },
  ],
};

// ----- Combat Text Profile -----

export const DRUID_COMBAT_TEXT_PROFILE: ClassCombatTextProfile = {
  classId: "druid",
  actionMappings: [
    {
      keyword: "wild-shape",
      normalizedPatterns: [/wildshape|usewildshape/],
      abilityId: "class:druid:wild-shape",
      category: "bonusAction",
    },
  ],
  attackEnhancements: [],
};
