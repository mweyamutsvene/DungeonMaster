import type { AbilityExecutor, AbilityExecutionContext, AbilityExecutionResult } from "../../../../../../domain/abilities/ability-executor.js";
import { TACTICAL_MIND } from "../../../../../../domain/entities/classes/feature-keys.js";
import { requireActor, requireSheet, requireResources, requireClassFeature, extractClassInfo } from "../executor-helpers.js";
import { hasResourceAvailable, spendResourceFromPool } from "../../../helpers/resource-utils.js";

/**
 * Tactical Mind executor (Fighter L2+, D&D 5e 2024).
 * After failing an ability check, spend one Second Wind use (no healing) to reroll
 * and take the higher result.
 */
export class TacticalMindExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return normalized === "classfightertacticalmind" || normalized === "tacticalmind";
  }

  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const { params } = context;

    const actorErr = requireActor(params); if (actorErr) return actorErr;
    const sheetErr = requireSheet(params); if (sheetErr) return sheetErr;
    const featureErr = requireClassFeature(params, TACTICAL_MIND, "Tactical Mind (requires Fighter level 2+)");
    if (featureErr) return featureErr;
    const resourcesErr = requireResources(params); if (resourcesErr) return resourcesErr;

    const resources = params!.resources;
    const { level } = extractClassInfo(params);

    try {
      if (!hasResourceAvailable(resources, "secondWind", 1)) {
        return {
          success: false,
          summary: "No Second Wind uses remaining for Tactical Mind (recharges on short rest)",
          error: "INSUFFICIENT_USES",
        };
      }

      const updatedResources = spendResourceFromPool(resources, "secondWind", 1);

      return {
        success: true,
        summary: `Tactical Mind (Fighter L${level})! Spent one Second Wind use — reroll the ability check and take the higher result.`,
        resourcesSpent: { secondWind: 1 },
        data: {
          abilityName: "Tactical Mind",
          spendResource: { poolName: "secondWind", amount: 1 },
          updatedResources,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        summary: `Tactical Mind failed: ${error.message}`,
        error: "EXECUTION_ERROR",
      };
    }
  }
}
