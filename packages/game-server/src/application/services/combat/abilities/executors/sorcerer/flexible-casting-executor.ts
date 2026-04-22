/**
 * Flexible Casting Executor (Font of Magic — D&D 5e 2024).
 *
 * Bonus action. Two directions:
 *  - SP → spell slot: costs {L1:2, L2:3, L3:5, L4:6, L5:7} sorcery points.
 *  - Spell slot → SP: spend one leveled slot to gain SP equal to its level.
 *
 * Both directions are a bonus action. The executor re-parses the raw action
 * text to determine direction + levels.
 */

import type {
  AbilityExecutor,
  AbilityExecutionContext,
  AbilityExecutionResult,
} from "../../../../../../domain/abilities/ability-executor.js";
import { FLEXIBLE_CASTING } from "../../../../../../domain/entities/classes/feature-keys.js";
import {
  hasResourceAvailable,
  spendResourceFromPool,
  updateResourcePool,
  normalizeResources,
} from "../../../helpers/resource-utils.js";
import {
  requireSheet,
  requireResources,
  requireClassFeature,
} from "../executor-helpers.js";
import type { JsonValue } from "../../../../../types.js";

/** SP cost to create a spell slot by level (RAW 2024). */
export const SP_TO_SLOT_COST: Record<number, number> = {
  1: 2,
  2: 3,
  3: 5,
  4: 6,
  5: 7,
};

export class FlexibleCastingExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return (
      normalized === "classsorcererflexiblecasting" ||
      normalized === "flexiblecasting" ||
      normalized === "fontofmagic"
    );
  }

  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const { params } = context;

    const sheetErr = requireSheet(params); if (sheetErr) return sheetErr;
    const featureErr = requireClassFeature(params, FLEXIBLE_CASTING, "Flexible Casting (requires Sorcerer level 2+)"); if (featureErr) return featureErr;
    const resourcesErr = requireResources(params); if (resourcesErr) return resourcesErr;

    const resources = params!.resources as JsonValue;
    const text = String((params as Record<string, unknown>).text ?? "").toLowerCase();

    // Detect direction. Patterns are lenient to accept common phrasings.
    const spToSlot = /convert\s+(?:an?|\d+)\s+sorcery\s+points?\s+(?:to|into|for)\s+.*slot/.test(text)
      || /convert\s+.*sorcery\s+points?\s+(?:to|into)\s+.*(?:level|st|nd|rd|th).*slot/.test(text);
    const slotToSp = /convert\s+(?:an?|one|\d+|a\s+)?\s*(?:level\s+\d+|\d+(?:st|nd|rd|th)\s*level)?\s*(?:spell\s+)?slot\s+(?:to|into|for)\s+.*sorcery\s+points?/.test(text);

    if (!spToSlot && !slotToSp) {
      return {
        success: false,
        summary: "Flexible Casting: could not parse conversion direction. Try 'convert 5 sorcery points to a level 3 spell slot' or 'convert a level 2 spell slot to sorcery points'.",
        error: "PARSE_ERROR",
      };
    }

    // Extract slot level — match "level N" or "Nth/st/nd/rd level".
    const levelMatch = /level\s+(\d+)|(\d+)\s*(?:st|nd|rd|th)\s*level/.exec(text);
    const slotLevel = levelMatch ? parseInt(levelMatch[1] ?? levelMatch[2] ?? "0", 10) : 0;

    if (spToSlot) {
      if (!(slotLevel in SP_TO_SLOT_COST)) {
        return {
          success: false,
          summary: `Flexible Casting: invalid target slot level ${slotLevel}. Must be 1-5.`,
          error: "INVALID_LEVEL",
        };
      }
      const cost = SP_TO_SLOT_COST[slotLevel];
      if (!hasResourceAvailable(resources, "sorceryPoints", cost)) {
        return {
          success: false,
          summary: `Flexible Casting: not enough sorcery points (need ${cost} for a level ${slotLevel} slot)`,
          error: "INSUFFICIENT_RESOURCES",
        };
      }

      const poolName = `spellSlot_${slotLevel}`;
      let updated: JsonValue = spendResourceFromPool(resources, "sorceryPoints", cost);
      // Increment the target slot pool (cap at max).
      const pools = normalizeResources(updated).resourcePools;
      const poolExists = Array.isArray(pools) && pools.some((p: any) => p?.name === poolName);
      if (!poolExists) {
        return {
          success: false,
          summary: `Flexible Casting: no ${poolName} pool exists for this character.`,
          error: "POOL_NOT_FOUND",
        };
      }
      let capReached = false;
      updated = updateResourcePool(updated, poolName, (pool) => {
        if (pool.current >= pool.max) {
          capReached = true;
          return pool;
        }
        return { ...pool, current: Math.min(pool.max, pool.current + 1) };
      });
      if (capReached) {
        return {
          success: false,
          summary: `Flexible Casting: ${poolName} is already at maximum.`,
          error: "AT_MAX",
        };
      }

      return {
        success: true,
        summary: `Flexible Casting: spent ${cost} sorcery points to create a level ${slotLevel} spell slot.`,
        data: {
          abilityName: "Flexible Casting",
          direction: "sp-to-slot",
          sorceryPointsSpent: cost,
          slotLevel,
          updatedResources: updated,
        },
      };
    }

    // slot → SP
    if (slotLevel < 1 || slotLevel > 5) {
      return {
        success: false,
        summary: `Flexible Casting: invalid source slot level ${slotLevel}. Must be 1-5.`,
        error: "INVALID_LEVEL",
      };
    }

    const poolName = `spellSlot_${slotLevel}`;
    if (!hasResourceAvailable(resources, poolName, 1)) {
      return {
        success: false,
        summary: `Flexible Casting: no level ${slotLevel} spell slot available to convert.`,
        error: "INSUFFICIENT_RESOURCES",
      };
    }

    // Spending a slot yields SP equal to the slot's level.
    let updated: JsonValue = spendResourceFromPool(resources, poolName, 1);
    const pools = normalizeResources(updated).resourcePools;
    const spExists = Array.isArray(pools) && pools.some((p: any) => p?.name === "sorceryPoints");
    if (!spExists) {
      return {
        success: false,
        summary: "Flexible Casting: no sorceryPoints pool exists for this character.",
        error: "POOL_NOT_FOUND",
      };
    }
    let spCapReached = false;
    updated = updateResourcePool(updated, "sorceryPoints", (pool) => {
      const headroom = pool.max - pool.current;
      if (headroom <= 0) {
        spCapReached = true;
        return pool;
      }
      return { ...pool, current: Math.min(pool.max, pool.current + slotLevel) };
    });
    if (spCapReached) {
      return {
        success: false,
        summary: "Flexible Casting: sorceryPoints pool is already at maximum.",
        error: "AT_MAX",
      };
    }

    return {
      success: true,
      summary: `Flexible Casting: spent a level ${slotLevel} spell slot to gain ${slotLevel} sorcery points.`,
      data: {
        abilityName: "Flexible Casting",
        direction: "slot-to-sp",
        slotLevel,
        sorceryPointsGained: slotLevel,
        updatedResources: updated,
      },
    };
  }
}
