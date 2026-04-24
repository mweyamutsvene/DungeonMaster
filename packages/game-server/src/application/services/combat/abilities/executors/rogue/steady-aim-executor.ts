/**
 * Steady Aim Executor (Rogue base feature, L3 in 2014, moved to L2 baseline Rogue in 2024 PHB).
 *
 * D&D 5e 2024 RAW:
 *  - Bonus action
 *  - Requires: you haven't moved this turn
 *  - Effect: advantage on your next attack roll this turn; your speed becomes 0 until end of turn
 *
 * Implementation scope: applies an `until_triggered` advantage effect + marks speed as 0.
 * The "haven't moved this turn" precondition is not yet enforced (would require reading
 * movement-budget state from resources); players are expected to use this as intended.
 */

import type {
  AbilityExecutor,
  AbilityExecutionContext,
  AbilityExecutionResult,
} from "../../../../../../domain/abilities/ability-executor.js";
import { STEADY_AIM } from "../../../../../../domain/entities/classes/feature-keys.js";
import { createEffect } from "../../../../../../domain/entities/combat/effects.js";
import { addActiveEffectsToResources, getActiveEffects } from "../../../helpers/resource-utils.js";
import { nanoid } from "nanoid";
import { requireSheet, requireResources, requireClassFeature } from "../executor-helpers.js";

export class SteadyAimExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return normalized === "classroguesteadyaim" || normalized === "steadyaim";
  }

  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const { params } = context;

    const sheetErr = requireSheet(params); if (sheetErr) return sheetErr;
    const featureErr = requireClassFeature(params, STEADY_AIM, "Steady Aim (requires Rogue level 2+)"); if (featureErr) return featureErr;
    const resourcesErr = requireResources(params); if (resourcesErr) return resourcesErr;

    const resources = params!.resources;

    try {
      const existingEffects = getActiveEffects(resources as any);
      const alreadyActive = existingEffects.some((e) => e.source === "Steady Aim");
      if (alreadyActive) {
        return {
          success: false,
          summary: "Steady Aim is already active this turn",
          error: "ALREADY_ACTIVE",
        };
      }

      // Grant advantage on the next attack roll — expires when a single attack triggers it.
      const advantageEffect = createEffect(
        nanoid(),
        "advantage",
        "attack_rolls",
        "until_triggered",
        {
          source: "Steady Aim",
          description: "Advantage on next attack roll this turn",
        },
      );

      // Mark speed as 0 until end of turn (prevents post-aim movement).
      const noMoveEffect = createEffect(
        nanoid(),
        "speed_modifier",
        "speed",
        "until_end_of_turn",
        {
          source: "Steady Aim",
          description: "Speed reduced to 0 this turn after taking Steady Aim",
          value: -9999,
        },
      );

      const updatedResources = addActiveEffectsToResources(
        resources as any,
        advantageEffect,
        noMoveEffect,
      );

      return {
        success: true,
        summary: "Takes Steady Aim. Gains advantage on the next attack roll this turn; speed is 0 for the rest of the turn.",
        data: {
          abilityName: "Steady Aim",
          updatedResources,
        },
      };
    } catch (err: any) {
      return {
        success: false,
        summary: err.message ?? "Failed to activate Steady Aim",
        error: "EXECUTION_ERROR",
      };
    }
  }
}
