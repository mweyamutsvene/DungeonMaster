/**
 * Quickened Spell Executor
 *
 * Handles the Sorcerer's "Quickened Spell" metamagic option.
 * Spend 2 sorcery points to change the next spell's casting time from
 * 1 action to 1 bonus action.
 *
 * - Costs 2 sorcery points
 * - Sets a quickenedSpellActive flag on resources
 * - Does NOT consume an action (modifies the next spell cast)
 *
 * D&D 5e 2024 rules.
 */

import type { AbilityExecutor, AbilityExecutionContext, AbilityExecutionResult } from "../../../../../../domain/abilities/ability-executor.js";
import { METAMAGIC } from "../../../../../../domain/entities/classes/feature-keys.js";
import {
  hasResourceAvailable,
  spendResourceFromPool,
} from "../../../helpers/resource-utils.js";
import { requireSheet, requireResources, requireClassFeature, extractClassInfo } from "../executor-helpers.js";

export class QuickenedSpellExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return normalized === "classsorcererquickenedspell" || normalized === "quickenedspell" || normalized === "quickenspell";
  }

  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const { params } = context;

    const sheetErr = requireSheet(params); if (sheetErr) return sheetErr;
    const featureErr = requireClassFeature(params, METAMAGIC, "Metamagic (requires Sorcerer level 2+)"); if (featureErr) return featureErr;
    const resourcesErr = requireResources(params); if (resourcesErr) return resourcesErr;

    const resources = params!.resources;

    try {
      // Check if quickened spell is already active
      const alreadyActive = (resources as any)?.quickenedSpellActive === true;
      if (alreadyActive) {
        return {
          success: false,
          summary: "Quickened Spell is already active",
          error: "ALREADY_ACTIVE",
        };
      }

      // Check sorcery points (costs 2)
      if (!hasResourceAvailable(resources, "sorceryPoints", 2)) {
        return {
          success: false,
          summary: "Not enough sorcery points (Quickened Spell costs 2)",
          error: "INSUFFICIENT_USES",
        };
      }

      // Spend 2 sorcery points
      let updatedResources = spendResourceFromPool(resources, "sorceryPoints", 2);

      // Set the quickenedSpellActive flag — the next spell cast uses bonus action
      updatedResources = {
        ...(updatedResources as Record<string, unknown>),
        quickenedSpellActive: true,
      } as any;

      return {
        success: true,
        summary: "Quickened Spell activated! The next spell cast this turn uses a bonus action instead of an action.",
        resourcesSpent: { sorceryPoints: 2 },
        data: {
          abilityName: "Quickened Spell",
          sorceryPointsSpent: 2,
          spendResource: { poolName: "sorceryPoints", amount: 2 },
          updatedResources,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        summary: `Quickened Spell failed: ${error.message}`,
        error: "EXECUTION_ERROR",
      };
    }
  }
}
