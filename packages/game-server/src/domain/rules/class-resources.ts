import type { ResourcePool } from "../entities/combat/resource-pool.js";
import type { CharacterClassId } from "../entities/classes/class-definition.js";
import { createRageState } from "../entities/classes/barbarian.js";
import { createKiState } from "../entities/classes/monk.js";
import { createSorceryPointsState } from "../entities/classes/sorcerer.js";
import { createPactMagicState } from "../entities/classes/warlock.js";
import { createActionSurgeState, createSecondWindState } from "../entities/classes/fighter.js";
import { createChannelDivinityState as createClericChannelDivinityState } from "../entities/classes/cleric.js";
import { createChannelDivinityState as createPaladinChannelDivinityState } from "../entities/classes/paladin.js";
import { createLayOnHandsState } from "../entities/classes/paladin.js";
import { createBardicInspirationState } from "../entities/classes/bard.js";
import { createWildShapeState } from "../entities/classes/druid.js";
import { createArcaneRecoveryState } from "../entities/classes/wizard.js";

export interface DefaultResourcePoolsOptions {
  classId: CharacterClassId;
  level: number;

  /**
   * Needed for Bardic Inspiration uses.
   */
  charismaModifier?: number;
}

export function defaultResourcePoolsForClass(options: DefaultResourcePoolsOptions): ResourcePool[] {
  const { classId, level } = options;

  switch (classId) {
    case "barbarian":
      return [createRageState(level).pool];

    case "monk": {
      const ki = createKiState(level);
      return ki.pool.max > 0 ? [ki.pool] : [];
    }

    case "cleric": {
      const cd = createClericChannelDivinityState(level);
      return cd.pool.max > 0 ? [cd.pool] : [];
    }

    case "paladin": {
      const pools: ResourcePool[] = [];

      const cd = createPaladinChannelDivinityState(level);
      if (cd.pool.max > 0) pools.push(cd.pool);

      const loh = createLayOnHandsState(level);
      if (loh.pool.max > 0) pools.push(loh.pool);

      return pools;
    }

    case "druid": {
      const ws = createWildShapeState(level);
      return ws.pool.max > 0 ? [ws.pool] : [];
    }

    case "wizard": {
      const ar = createArcaneRecoveryState(level);
      return ar.pool.max > 0 ? [ar.pool] : [];
    }

    case "fighter": {
      const pools: ResourcePool[] = [];
      const actionSurge = createActionSurgeState(level);
      if (actionSurge.pool.max > 0) pools.push(actionSurge.pool);

      const secondWind = createSecondWindState(level);
      if (secondWind.pool.max > 0) pools.push(secondWind.pool);

      return pools;
    }

    case "sorcerer": {
      const sp = createSorceryPointsState(level);
      return sp.pool.max > 0 ? [sp.pool] : [];
    }

    case "warlock":
      return [createPactMagicState(level).pool];

    case "bard": {
      const cha = options.charismaModifier;
      if (cha === undefined) {
        throw new Error("charismaModifier is required to initialize bard resource pools");
      }
      return [createBardicInspirationState(level, cha).pool];
    }

    default:
      return [];
  }
}
