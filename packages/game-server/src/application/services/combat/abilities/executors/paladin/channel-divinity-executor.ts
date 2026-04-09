/**
 * Channel Divinity: Divine Sense Executor
 *
 * Handles the Paladin's "Channel Divinity: Divine Sense" feature (level 3+).
 * As a bonus action, expend 1 Channel Divinity use to detect celestials,
 * fiends, and undead within 60 feet.
 *
 * D&D 5e 2024 rules.
 */

import type {
  AbilityExecutor,
  AbilityExecutionContext,
  AbilityExecutionResult,
} from "../../../../../../domain/abilities/ability-executor.js";
import { CHANNEL_DIVINITY } from "../../../../../../domain/entities/classes/feature-keys.js";
import { requireSheet, requireResources, requireClassFeature } from "../executor-helpers.js";
import { hasResourceAvailable, hasBonusActionAvailable } from "../../../helpers/resource-utils.js";

export class ChannelDivinityExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return (
      normalized === "classpaladinchanneldivinity" ||
      normalized === "classpaladinidivinesense" ||
      normalized === "classpaladinidivinesense" ||
      normalized === "classpaladinidivinesense" ||
      normalized === "divinesense"
    );
  }

  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const { params } = context;

    const sheetErr = requireSheet(params); if (sheetErr) return sheetErr;
    const featureErr = requireClassFeature(params, CHANNEL_DIVINITY, "Channel Divinity (requires Paladin level 3+)"); if (featureErr) return featureErr;
    const resourcesErr = requireResources(params); if (resourcesErr) return resourcesErr;

    const resources = params!.resources;

    try {
      // Check bonus action availability (Divine Sense is a bonus action in 2024)
      if (!hasBonusActionAvailable(resources)) {
        return {
          success: false,
          summary: "No bonus action available (Divine Sense requires a bonus action)",
          error: "NO_BONUS_ACTION",
        };
      }

      // Check Channel Divinity uses
      if (!hasResourceAvailable(resources, "channelDivinity:paladin", 1)) {
        return {
          success: false,
          summary: "No Channel Divinity uses remaining (recharges on short/long rest)",
          error: "INSUFFICIENT_USES",
        };
      }

      return {
        success: true,
        summary: "Channels divinity to use Divine Sense! Detects the location and type of celestials, fiends, and undead within 60 feet.",
        data: {
          abilityName: "Divine Sense",
          aoeEffect: "divineSense",
          range: 60,
          detectsCreatureTypes: ["celestial", "fiend", "undead"],
          spendResource: { poolName: "channelDivinity:paladin", amount: 1 },
        },
      };
    } catch (err: any) {
      return {
        success: false,
        summary: err.message ?? "Failed to use Divine Sense",
        error: "EXECUTION_ERROR",
      };
    }
  }
}
