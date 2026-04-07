import type { ResourcePool } from "../combat/resource-pool.js";
import { spendResource } from "../combat/resource-pool.js";
import type { CharacterClassDefinition, ClassCapability } from "./class-definition.js";
import type { ClassCombatTextProfile } from "./combat-text-profile.js";

export interface ChannelDivinityState {
  pool: ResourcePool;
}

/**
 * Channel Divinity uses per level (D&D 5e 2024 rules).
 * Level 2: 2 uses, Level 6: 3 uses, Level 18: 4 uses.
 */
export function clericChannelDivinityUsesForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error(`Invalid level: ${level}`);
  }

  // D&D 5e 2024: Channel Divinity gained at level 2.
  if (level < 2) return 0;
  if (level < 6) return 2;
  if (level < 18) return 3;
  return 4;
}

export function createChannelDivinityState(level: number): ChannelDivinityState {
  const max = clericChannelDivinityUsesForLevel(level);
  return { pool: { name: "channelDivinity", current: max, max } };
}

export function spendChannelDivinity(
  state: ChannelDivinityState,
  amount: number,
): ChannelDivinityState {
  return { pool: spendResource(state.pool, amount) };
}

export function resetChannelDivinityOnShortRest(
  level: number,
  state: ChannelDivinityState,
): ChannelDivinityState {
  const max = clericChannelDivinityUsesForLevel(level);
  return { pool: { name: state.pool.name, current: max, max } };
}

/**
 * Cleric combat text profile.
 * - Turn Undead: classAction that uses Channel Divinity (costs regular action)
 */
export const CLERIC_COMBAT_TEXT_PROFILE: ClassCombatTextProfile = {
  classId: "cleric",
  actionMappings: [
    {
      keyword: "turn-undead",
      abilityId: "class:cleric:turn-undead",
      category: "classAction" as const,
      normalizedPatterns: [/turnundead/, /turningundead/],
    },
  ],
  attackEnhancements: [],
};

export const Cleric: CharacterClassDefinition = {
  id: "cleric",
  name: "Cleric",
  hitDie: 8,
  proficiencies: {
    savingThrows: ["wisdom", "charisma"],
    armor: ["light", "medium", "shield"],
  },
  features: {
    "spellcasting": 1,
    "channel-divinity": 2,
    "turn-undead": 2,
  },
  resourcesAtLevel: (level) => {
    const cd = createChannelDivinityState(level);
    return cd.pool.max > 0 ? [cd.pool] : [];
  },
  resourcePoolFactory: (level) => {
    const cd = createChannelDivinityState(level);
    return cd.pool.max > 0 ? [cd.pool] : [];
  },
  restRefreshPolicy: [
    { poolKey: "channelDivinity", refreshOn: "both", computeMax: (level) => clericChannelDivinityUsesForLevel(level) },
  ],
  capabilitiesForLevel: (level): readonly ClassCapability[] => {
    const caps: ClassCapability[] = [
      { name: "Spellcasting", economy: "action", effect: "Cast cleric spells using Wisdom" },
    ];
    if (level >= 2) {
      caps.push({ name: "Channel Divinity", economy: "action", cost: `${clericChannelDivinityUsesForLevel(level)} uses/short rest`, effect: "Channel divine energy for magical effects" });
      caps.push({ name: "Turn Undead", economy: "action", cost: "1 Channel Divinity use", effect: "Undead within 30 ft must succeed WIS save or be turned", abilityId: "class:cleric:turn-undead", resourceCost: { pool: "channelDivinity", amount: 1 } });
    }
    return caps;
  },
};
