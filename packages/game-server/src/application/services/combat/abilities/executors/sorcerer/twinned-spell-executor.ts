/**
 * Twinned Spell Executor
 *
 * Handles the Sorcerer's "Twinned Spell" metamagic option.
 * Spend sorcery points equal to a spell's level (minimum 1 for cantrips)
 * to target a second creature with a single-target spell.
 *
 * - Costs sorcery points = spell level (minimum 1)
 * - Sets a twinnedSpellActive flag on resources
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
import { requireSheet, requireResources, requireClassFeature } from "../executor-helpers.js";

export class TwinnedSpellExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return normalized === "classsorcerertwinnedspell" || normalized === "twinnedspell" || normalized === "twinspell";
  }

  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const { params } = context;

    const sheetErr = requireSheet(params); if (sheetErr) return sheetErr;
    const featureErr = requireClassFeature(params, METAMAGIC, "Metamagic (requires Sorcerer level 2+)"); if (featureErr) return featureErr;
    const resourcesErr = requireResources(params); if (resourcesErr) return resourcesErr;

    const resources = params!.resources;

    try {
      // Check if twinned spell is already active
      const alreadyActive = (resources as any)?.twinnedSpellActive === true;
      if (alreadyActive) {
        return {
          success: false,
          summary: "Twinned Spell is already active",
          error: "ALREADY_ACTIVE",
        };
      }

      // Determine sorcery point cost from spell level (minimum 1 for cantrips)
      const spellLevel = (params?.spellLevel as number) ?? 1;
      const cost = Math.max(1, spellLevel);

      // Check sorcery points
      if (!hasResourceAvailable(resources, "sorceryPoints", cost)) {
        return {
          success: false,
          summary: `Not enough sorcery points (Twinned Spell costs ${cost} for a level ${spellLevel} spell)`,
          error: "INSUFFICIENT_USES",
        };
      }

      // Spend sorcery points
      let updatedResources = spendResourceFromPool(resources, "sorceryPoints", cost);

      // Set the twinnedSpellActive flag — the next single-target spell targets a second creature
      updatedResources = {
        ...(updatedResources as Record<string, unknown>),
        twinnedSpellActive: true,
      } as any;

      return {
        success: true,
        summary: `Twinned Spell activated (${cost} sorcery point${cost > 1 ? "s" : ""})! The next single-target spell will also affect a second target.`,
        resourcesSpent: { sorceryPoints: cost },
        data: {
          abilityName: "Twinned Spell",
          sorceryPointsSpent: cost,
          spellLevel,
          spendResource: { poolName: "sorceryPoints", amount: cost },
          updatedResources,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        summary: `Twinned Spell failed: ${error.message}`,
        error: "EXECUTION_ERROR",
      };
    }
  }
}
