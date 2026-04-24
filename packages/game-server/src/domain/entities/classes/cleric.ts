import type { ResourcePool } from "../combat/resource-pool.js";
import { spendResource } from "../combat/resource-pool.js";
import type { CharacterClassDefinition, ClassCapability, SubclassDefinition } from "./class-definition.js";
import type { ClassCombatTextProfile } from "./combat-text-profile.js";
import { DISCIPLE_OF_LIFE, PRESERVE_LIFE, LIFE_DOMAIN_SPELLS } from "./feature-keys.js";

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
  return { pool: { name: "channelDivinity:cleric", current: max, max } };
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
 * Destroy Undead CR threshold by Cleric level (D&D 5e 2024).
 * Starting at level 5, undead that fail the Turn Undead save and have
 * CR at or below this threshold are instantly destroyed.
 *
 * Returns null if the cleric is below level 5 (feature not yet available).
 */
export function getDestroyUndeadCRThreshold(clericLevel: number): number | null {
  if (clericLevel < 5) return null;
  if (clericLevel < 8) return 0.5;
  if (clericLevel < 11) return 1;
  if (clericLevel < 14) return 2;
  if (clericLevel < 17) return 3;
  return 4;
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
    {
      keyword: "divine-spark",
      abilityId: "class:cleric:divine-spark",
      category: "classAction" as const,
      normalizedPatterns: [/^divinespark$/, /^divinesparkdamage$/, /^divinesparkheal$/, /^channeldivinityspark$/],
    },
  ],
  attackEnhancements: [],
};

// ----- Subclasses -----

/**
 * Life Domain subclass (D&D 5e 2024).
 * Shell definition — executors for Disciple of Life (bonus heal) and
 * Preserve Life (Channel Divinity pool heal) are deferred to Phase 3.
 */
export const LifeDomainSubclass: SubclassDefinition = {
  id: "life-domain",
  name: "Life Domain",
  classId: "cleric",
  features: {
    [DISCIPLE_OF_LIFE]: 3,
    [PRESERVE_LIFE]: 3,
    [LIFE_DOMAIN_SPELLS]: 3,
  },
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
    "divine-spark": 2,
    "destroy-undead": 5,
  },
  resourcesAtLevel: (level) => {
    const cd = createChannelDivinityState(level);
    return cd.pool.max > 0 ? [cd.pool] : [];
  },
  restRefreshPolicy: [
    { poolKey: "channelDivinity:cleric", refreshOn: "both", computeMax: (level) => clericChannelDivinityUsesForLevel(level) },
  ],
  capabilitiesForLevel: (level): readonly ClassCapability[] => {
    const caps: ClassCapability[] = [
      { name: "Spellcasting", economy: "action", effect: "Cast cleric spells using Wisdom" },
    ];
    if (level >= 2) {
      caps.push({ name: "Channel Divinity", economy: "action", cost: `${clericChannelDivinityUsesForLevel(level)} uses/short rest`, effect: "Channel divine energy for magical effects" });
      caps.push({ name: "Turn Undead", economy: "action", cost: "1 Channel Divinity use", effect: "Undead within 30 ft must succeed WIS save or be turned", abilityId: "class:cleric:turn-undead", resourceCost: { pool: "channelDivinity:cleric", amount: 1 } });
      caps.push({ name: "Divine Spark", economy: "action", cost: "1 Channel Divinity use", effect: "Radiant/necrotic damage (CON save for half) OR restore HP — scales 1d8 per tier", abilityId: "class:cleric:divine-spark", resourceCost: { pool: "channelDivinity:cleric", amount: 1 } });
    }
    return caps;
  },
  subclasses: [LifeDomainSubclass],
};
