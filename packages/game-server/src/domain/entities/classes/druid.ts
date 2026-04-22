import type { ResourcePool } from "../combat/resource-pool.js";
import { spendResource } from "../combat/resource-pool.js";
import type { CharacterClassDefinition, ClassCapability, SubclassDefinition } from "./class-definition.js";
import type { ClassCombatTextProfile } from "./combat-text-profile.js";
import { CIRCLE_SPELLS, LANDS_AID } from "./feature-keys.js";

export interface WildShapeState {
  pool: ResourcePool;
}

/**
 * D&D 5e 2024: Wild Shape uses three standardized beast stat blocks
 * that scale with druid level instead of CR-based beast forms.
 */
export type WildShapeBeastForm = "Beast of the Land" | "Beast of the Sea" | "Beast of the Sky";

/**
 * Stat block template for a Wild Shape beast form at a given druid level.
 * HP, AC, attack bonus, and damage scale with druid level.
 */
export interface WildShapeBeastStatBlock {
  form: WildShapeBeastForm;
  ac: number;
  hp: number;
  speed: string;
  attackBonus: number;
  damage: string;
  multiattack: boolean;
}

/**
 * Available beast forms at each druid level tier.
 * - Level 2: Beast of the Land
 * - Level 4: Beast of the Sea
 * - Level 8: Beast of the Sky (flight)
 */
export function availableBeastForms(level: number): readonly WildShapeBeastForm[] {
  if (level < 2) return [];
  if (level < 4) return ["Beast of the Land"];
  if (level < 8) return ["Beast of the Land", "Beast of the Sea"];
  return ["Beast of the Land", "Beast of the Sea", "Beast of the Sky"];
}

/**
 * Get the stat block for a beast form at the given druid level.
 * All forms scale identically per the 2024 rules; they differ in movement type.
 */
export function getBeastFormStatBlock(form: WildShapeBeastForm, level: number): WildShapeBeastStatBlock {
  if (level < 2) {
    throw new Error("Wild Shape not available below level 2");
  }

  // Temp HP in beast form = 5 × druid level (2024 rules)
  const hp = 5 * level;
  // AC = 10 + WIS mod is handled at runtime; base AC scales by tier
  const ac = level < 5 ? 13 : level < 9 ? 14 : level < 13 ? 15 : level < 17 ? 16 : 17;
  const attackBonus = level < 5 ? 5 : level < 9 ? 6 : level < 13 ? 7 : level < 17 ? 8 : 9;
  const damageDice = level < 5 ? "1d8" : level < 9 ? "2d6" : level < 13 ? "2d8" : level < 17 ? "3d6" : "3d8";
  const multiattack = level >= 5;

  const speedMap: Record<WildShapeBeastForm, string> = {
    "Beast of the Land": `${30 + (level >= 9 ? 10 : 0)} ft., climb ${30 + (level >= 9 ? 10 : 0)} ft.`,
    "Beast of the Sea": `10 ft., swim ${30 + (level >= 9 ? 10 : 0)} ft.`,
    "Beast of the Sky": `10 ft., fly ${60 + (level >= 9 ? 10 : 0)} ft.`,
  };

  return {
    form,
    ac,
    hp,
    speed: speedMap[form],
    attackBonus,
    damage: damageDice,
    multiattack,
  };
}

export function wildShapeUsesForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error(`Invalid level: ${level}`);
  }

  // 2024: Wild Shape gained at level 2; uses = proficiency bonus (scales with level).
  if (level < 2) return 0;
  // Proficiency bonus: 2 at level 1-4, 3 at 5-8, 4 at 9-12, 5 at 13-16, 6 at 17-20
  if (level < 5) return 2;
  if (level < 9) return 3;
  if (level < 13) return 4;
  if (level < 17) return 5;
  return 6;
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

// ----- Subclasses -----

/**
 * Circle of the Land (Grassland) subclass (D&D 5e 2024).
 * Shell definition — executors for Circle Spells (terrain-bound spells) and
 * Land's Aid (Channel Divinity-style necrotic burst / heal) are deferred to Phase 3.
 */
export const CircleOfTheLandGrasslandSubclass: SubclassDefinition = {
  id: "circle-of-the-land-grassland",
  name: "Circle of the Land (Grassland)",
  classId: "druid",
  features: {
    [CIRCLE_SPELLS]: 3,
    [LANDS_AID]: 3,
  },
};

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
  capabilitiesForLevel: (level): readonly ClassCapability[] => {
    const caps: ClassCapability[] = [
      { name: "Spellcasting", economy: "action", effect: "Cast druid spells using WIS" },
    ];
    if (level >= 2) {
      const forms = availableBeastForms(level);
      const formList = forms.join(", ");
      caps.push({
        name: "Wild Shape",
        economy: "bonusAction",
        cost: `1 use (${wildShapeUsesForLevel(level)}/long rest, regain 1 on short rest)`,
        effect: `Transform into a standardized beast form: ${formList}`,
        abilityId: "class:druid:wild-shape",
        resourceCost: { pool: "wildShape", amount: 1 },
      });
    }
    return caps;
  },
  restRefreshPolicy: [
    { poolKey: "wildShape", refreshOn: "both", computeMax: (level) => wildShapeUsesForLevel(level) },
  ],
  subclasses: [CircleOfTheLandGrasslandSubclass],
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
