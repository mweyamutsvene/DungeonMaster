import type { ResourcePool } from "../entities/combat/resource-pool.js";
import type { CharacterClassId } from "../entities/classes/class-definition.js";
import { rageUsesForLevel } from "../entities/classes/barbarian.js";
import { kiPointsForLevel } from "../entities/classes/monk.js";
import {
  channelDivinityUsesForLevel as clericChannelDivinityUsesForLevel,
} from "../entities/classes/cleric.js";
import {
  channelDivinityUsesForLevel as paladinChannelDivinityUsesForLevel,
} from "../entities/classes/paladin.js";
import { actionSurgeUsesForLevel, secondWindUsesForLevel } from "../entities/classes/fighter.js";
import { sorceryPointsForLevel } from "../entities/classes/sorcerer.js";
import { pactMagicSlotsForLevel } from "../entities/classes/warlock.js";
import { bardicInspirationUsesForLevel } from "../entities/classes/bard.js";
import { wildShapeUsesForLevel } from "../entities/classes/druid.js";
import { arcaneRecoveryUsesForLevel } from "../entities/classes/wizard.js";
import { layOnHandsPoolForLevel } from "../entities/classes/paladin.js";

export type RestType = "short" | "long";

export interface RefreshClassResourcePoolsOptions {
  classId: CharacterClassId;
  level: number;
  rest: RestType;

  pools: readonly ResourcePool[];

  /**
   * Required only when refreshing Bardic Inspiration.
   */
  charismaModifier?: number;
}

function shouldRefreshOnRest(poolName: string, rest: RestType, level: number): boolean {
  switch (poolName) {
    case "rage":
      return rest === "long";

    case "layOnHands":
      return rest === "long";

    case "arcaneRecovery":
      return rest === "long";

    case "sorceryPoints":
      return rest === "long";
    case "bardicInspiration":
      // Font of Inspiration at 5+: refreshes on short rest.
      return rest === "long" || (rest === "short" && level >= 5);
    case "ki":
    case "channelDivinity":
    case "actionSurge":
    case "secondWind":
    case "pactMagic":
    case "wildShape":
      return true;
    default:
      return false;
  }
}

function computeMaxForPool(
  options: RefreshClassResourcePoolsOptions,
  poolName: string,
): number {
  const { classId, level } = options;

  switch (poolName) {
    case "rage":
      return rageUsesForLevel(level);

    case "wildShape":
      return wildShapeUsesForLevel(level);

    case "ki":
      return kiPointsForLevel(level);

    case "channelDivinity":
      if (classId === "cleric") return clericChannelDivinityUsesForLevel(level);
      if (classId === "paladin") return paladinChannelDivinityUsesForLevel(level);
      return 0;

    case "layOnHands":
      return layOnHandsPoolForLevel(level);

    case "actionSurge":
      return actionSurgeUsesForLevel(level);

    case "secondWind":
      return secondWindUsesForLevel(level);

    case "sorceryPoints":
      return sorceryPointsForLevel(level);

    case "arcaneRecovery":
      return arcaneRecoveryUsesForLevel(level);

    case "pactMagic":
      return pactMagicSlotsForLevel(level).slots;

    case "bardicInspiration": {
      const cha = options.charismaModifier;
      if (cha === undefined) {
        throw new Error("charismaModifier is required to refresh bardicInspiration");
      }
      return bardicInspirationUsesForLevel(level, cha);
    }

    default:
      return 0;
  }
}

export function refreshClassResourcePools(
  options: RefreshClassResourcePoolsOptions,
): ResourcePool[] {
  return options.pools.map((pool) => {
    if (!shouldRefreshOnRest(pool.name, options.rest, options.level)) {
      return pool;
    }

    const max = computeMaxForPool(options, pool.name);
    return { ...pool, current: max, max };
  });
}
