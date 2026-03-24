/**
 * Lay on Hands Executor
 *
 * Handles the Paladin's "Lay on Hands" class feature (level 1+).
 * As a bonus action, restore HP from a pool of 5 × Paladin level.
 * Heals the maximum amount possible (capped by missing HP and pool remaining).
 *
 * D&D 5e 2024 rules.
 */

import type {
  AbilityExecutor,
  AbilityExecutionContext,
  AbilityExecutionResult,
} from "../../../../../../domain/abilities/ability-executor.js";
import { LAY_ON_HANDS } from "../../../../../../domain/entities/classes/feature-keys.js";
import { requireSheet, requireResources, requireClassFeature } from "../executor-helpers.js";
import { hasResourceAvailable, hasBonusActionAvailable } from "../../../helpers/resource-utils.js";

export class LayOnHandsExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return normalized === "classpaladinlayonhands" || normalized === "layonhands";
  }

  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const { actor, params } = context;

    const sheetErr = requireSheet(params); if (sheetErr) return sheetErr;
    const featureErr = requireClassFeature(params, LAY_ON_HANDS, "Lay on Hands (requires Paladin class)"); if (featureErr) return featureErr;
    const resourcesErr = requireResources(params); if (resourcesErr) return resourcesErr;

    const resources = params!.resources;

    try {
      // Check bonus action availability
      if (!hasBonusActionAvailable(resources)) {
        return {
          success: false,
          summary: "No bonus action available (Lay on Hands requires a bonus action)",
          error: "NO_BONUS_ACTION",
        };
      }

      // Check pool has HP remaining
      if (!hasResourceAvailable(resources, "layOnHands", 1)) {
        return {
          success: false,
          summary: "No Lay on Hands HP remaining (recharges on long rest)",
          error: "INSUFFICIENT_USES",
        };
      }

      // Calculate healing: heal max possible, capped by missing HP and pool remaining
      const currentHP = actor.getCurrentHP();
      const maxHP = actor.getMaxHP();
      const missingHP = maxHP - currentHP;

      if (missingHP <= 0) {
        return {
          success: false,
          summary: "Already at full HP — no healing needed",
          error: "FULL_HP",
        };
      }

      // Find pool remaining
      const res = resources as Record<string, unknown>;
      const pools = (res.resourcePools ?? []) as Array<{ name: string; current: number; max: number }>;
      const lohPool = pools.find((p) => p.name === "layOnHands");
      const poolRemaining = lohPool?.current ?? 0;

      if (poolRemaining <= 0) {
        return {
          success: false,
          summary: "No Lay on Hands HP remaining",
          error: "INSUFFICIENT_USES",
        };
      }

      const healAmount = Math.min(missingHP, poolRemaining);
      const newHP = currentHP + healAmount;

      return {
        success: true,
        summary: `Lays on Hands! Restores ${healAmount} HP. (${poolRemaining - healAmount} HP remaining in pool)`,
        data: {
          abilityName: "Lay on Hands",
          hpUpdate: { hpCurrent: newHP },
          spendResource: { poolName: "layOnHands", amount: healAmount },
        },
      };
    } catch (err: any) {
      return {
        success: false,
        summary: err.message ?? "Failed to use Lay on Hands",
        error: "EXECUTION_ERROR",
      };
    }
  }
}
