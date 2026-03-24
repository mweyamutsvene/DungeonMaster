import type { ResourcePool } from "../combat/resource-pool.js";
import { spendResource } from "../combat/resource-pool.js";
import type { CharacterClassDefinition, ClassCapability } from "./class-definition.js";
import type { ClassCombatTextProfile } from "./combat-text-profile.js";

export interface ChannelDivinityState {
  pool: ResourcePool;
}

export interface LayOnHandsState {
  pool: ResourcePool;
}

export function layOnHandsPoolForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error(`Invalid level: ${level}`);
  }

  return 5 * level;
}

export function createLayOnHandsState(level: number): LayOnHandsState {
  const max = layOnHandsPoolForLevel(level);
  return { pool: { name: "layOnHands", current: max, max } };
}

export function spendLayOnHands(state: LayOnHandsState, amount: number): LayOnHandsState {
  return { pool: spendResource(state.pool, amount) };
}

export function resetLayOnHandsOnLongRest(level: number, state: LayOnHandsState): LayOnHandsState {
  const max = layOnHandsPoolForLevel(level);
  return { pool: { name: state.pool.name, current: max, max } };
}

export function paladinChannelDivinityUsesForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error(`Invalid level: ${level}`);
  }

  // Channel Divinity is gained at level 3 for paladins.
  if (level < 3) return 0;
  if (level < 7) return 1;
  if (level < 18) return 2;
  return 3;
}

export function createChannelDivinityState(level: number): ChannelDivinityState {
  const max = paladinChannelDivinityUsesForLevel(level);
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
  const max = paladinChannelDivinityUsesForLevel(level);
  return { pool: { name: state.pool.name, current: max, max } };
}

/**
 * Calculate Divine Smite dice count for a given spell slot level.
 * D&D 5e 2024: 2d8 for 1st-level slot, +1d8 per slot level above 1st.
 */
export function divineSmiteDice(slotLevel: number): number {
  return Math.min(1 + slotLevel, 6); // 2d8 at 1st, 3d8 at 2nd, ... 6d8 at 5th
}

/**
 * Paladin combat text profile.
 * - Divine Smite: hit-rider enhancement that adds radiant bonus dice on melee hit (costs spell slot + bonus action)
 * - Lay on Hands: bonus action healing from HP pool
 */
export const PALADIN_COMBAT_TEXT_PROFILE: ClassCombatTextProfile = {
  classId: "paladin",
  actionMappings: [
    {
      keyword: "lay-on-hands",
      abilityId: "class:paladin:lay-on-hands",
      category: "bonusAction" as const,
      normalizedPatterns: [/layonhands/, /layinghands/, /layhands/],
    },
  ],
  attackEnhancements: [
    {
      keyword: "divine-smite",
      displayName: "Divine Smite",
      patterns: [/\bdivine\s*smite\b/],
      minLevel: 2,
      // No resourceCost here — spell slot validation is done in the roll-state-machine
      // because Divine Smite can use ANY available spell slot level (1-5).
      requiresMelee: true,
      trigger: "onHit",
    },
  ],
};

export const Paladin: CharacterClassDefinition = {
  id: "paladin",
  name: "Paladin",
  hitDie: 10,
  proficiencies: {
    savingThrows: ["wisdom", "charisma"],
  },
  features: {
    "lay-on-hands": 1,
    "divine-smite": 2,
    "channel-divinity": 3,
    "extra-attack": 5,
  },
  resourcesAtLevel: (level) => {
    const pools: ResourcePool[] = [];
    pools.push(createLayOnHandsState(level).pool);

    const cd = createChannelDivinityState(level);
    if (cd.pool.max > 0) pools.push(cd.pool);

    return pools;
  },
  // resourcePoolFactory preserves original switch-case order: CD first, then LoH.
  resourcePoolFactory: (level) => {
    const pools: ResourcePool[] = [];

    const cd = createChannelDivinityState(level);
    if (cd.pool.max > 0) pools.push(cd.pool);

    const loh = createLayOnHandsState(level);
    if (loh.pool.max > 0) pools.push(loh.pool);

    return pools;
  },
  restRefreshPolicy: [
    { poolKey: "layOnHands", refreshOn: "long", computeMax: (level) => layOnHandsPoolForLevel(level) },
    { poolKey: "channelDivinity", refreshOn: "both", computeMax: (level) => paladinChannelDivinityUsesForLevel(level) },
  ],
  capabilitiesForLevel: (level): readonly ClassCapability[] => {
    const caps: ClassCapability[] = [
      { name: "Lay on Hands", economy: "bonusAction", cost: `${layOnHandsPoolForLevel(level)} HP pool/long rest`, effect: "Restore HP from healing pool", abilityId: "class:paladin:lay-on-hands", resourceCost: { pool: "layOnHands", amount: 5 } },
    ];
    if (level >= 2) {
      caps.push({ name: "Divine Smite", economy: "bonusAction", cost: "1 spell slot", requires: "Melee weapon hit", effect: "Add 2d8+ radiant damage on melee hit", abilityId: "class:paladin:divine-smite" });
    }
    if (level >= 3) {
      caps.push({ name: "Channel Divinity", economy: "action", cost: `${paladinChannelDivinityUsesForLevel(level)} uses/short rest`, effect: "Channel divine energy for oath abilities" });
    }
    if (level >= 5) {
      caps.push({ name: "Extra Attack", economy: "action", requires: "Attack action", effect: "Attack twice per Attack action" });
    }
    return caps;
  },
};
