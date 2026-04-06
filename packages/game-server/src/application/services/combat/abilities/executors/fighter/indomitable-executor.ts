/**
 * Indomitable Executor
 *
 * Handles the Fighter's "Indomitable" class feature (level 9+).
 * When you fail a saving throw, you can reroll it and must use the new roll.
 * Uses per long rest: 1 at level 9, 2 at level 13, 3 at level 17.
 */

import type { AbilityExecutor, AbilityExecutionContext, AbilityExecutionResult } from "../../../../../../domain/abilities/ability-executor.js";
import { INDOMITABLE } from "../../../../../../domain/entities/classes/feature-keys.js";
import { requireActor, requireSheet, requireResources, requireClassFeature, extractClassInfo } from "../executor-helpers.js";
import { hasResourceAvailable, spendResourceFromPool } from "../../../helpers/resource-utils.js";

/**
 * Executor for Indomitable (Fighter class feature).
 *
 * Handles:
 * - class:fighter:indomitable
 * - indomitable
 *
 * Prerequisites:
 * - Must be a Fighter level 9+
 * - Must have Indomitable uses remaining (recharges on long rest)
 *
 * Effect:
 * - Grants a reroll of a failed saving throw (must use the new roll)
 */
export class IndomitableExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return (
      normalized === "classfighterindomitable" ||
      normalized === "indomitable"
    );
  }

  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const { params } = context;

    const actorErr = requireActor(params); if (actorErr) return actorErr;
    const sheetErr = requireSheet(params); if (sheetErr) return sheetErr;
    const featureErr = requireClassFeature(params, INDOMITABLE, "Indomitable (requires Fighter level 9+)"); if (featureErr) return featureErr;
    const resourcesErr = requireResources(params); if (resourcesErr) return resourcesErr;

    const resources = params!.resources;

    try {
      if (!hasResourceAvailable(resources, "indomitable", 1)) {
        return {
          success: false,
          summary: "No Indomitable uses remaining (recharges on long rest)",
          error: "INSUFFICIENT_USES",
        };
      }

      const updatedResources = spendResourceFromPool(resources, "indomitable", 1);

      return {
        success: true,
        summary: "Indomitable! You may reroll the failed saving throw (must use the new roll).",
        resourcesSpent: { indomitable: 1 },
        data: {
          abilityName: "Indomitable",
          spendResource: { poolName: "indomitable", amount: 1 },
          updatedResources,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        summary: `Indomitable failed: ${error.message}`,
        error: "EXECUTION_ERROR",
      };
    }
  }
}
