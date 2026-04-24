/**
 * Innate Sorcery Executor (Sorcerer L1, 2024 PHB).
 *
 * RAW 2024:
 *  - Bonus action
 *  - Duration: 1 minute (10 rounds)
 *  - Effect: advantage on Sorcerer spell attack rolls + spell save DC +1
 *  - Uses: 2 per long rest
 *
 * Implementation: applies two ActiveEffects on self (advantage on attack rolls +
 * +1 spell save DC buff). Duration tracked via `rounds` (roundsRemaining=10)
 * since no "minute-scale" duration exists in the effect system; 10 rounds ≈ 1 minute.
 * The advantage uses the broader `attack_rolls` target — the effect system does not
 * currently distinguish spell attacks from weapon attacks on the advantage pipeline.
 *
 * Resource pool (`innateSorcery`) is expected to be added to Sorcerer resources
 * and refresh on long rest. If the pool is missing (older character setup), the
 * executor still applies the effects — use count tracking is a future improvement.
 */

import type {
  AbilityExecutor,
  AbilityExecutionContext,
  AbilityExecutionResult,
} from "../../../../../../domain/abilities/ability-executor.js";
import { INNATE_SORCERY } from "../../../../../../domain/entities/classes/feature-keys.js";
import { createEffect } from "../../../../../../domain/entities/combat/effects.js";
import { addActiveEffectsToResources, getActiveEffects } from "../../../helpers/resource-utils.js";
import { nanoid } from "nanoid";
import { requireSheet, requireResources, requireClassFeature } from "../executor-helpers.js";

export class InnateSorceryExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return normalized === "classsorcererinnatesorcery" || normalized === "innatesorcery";
  }

  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const { params } = context;

    const sheetErr = requireSheet(params); if (sheetErr) return sheetErr;
    const featureErr = requireClassFeature(params, INNATE_SORCERY, "Innate Sorcery (requires Sorcerer level 1+)"); if (featureErr) return featureErr;
    const resourcesErr = requireResources(params); if (resourcesErr) return resourcesErr;

    const resources = params!.resources;

    try {
      const existingEffects = getActiveEffects(resources as any);
      const alreadyActive = existingEffects.some((e) => e.source === "Innate Sorcery");
      if (alreadyActive) {
        return {
          success: false,
          summary: "Innate Sorcery is already active",
          error: "ALREADY_ACTIVE",
        };
      }

      // Advantage on your attack rolls (narrated as Sorcerer-spell-only) for 10 rounds = 1 min.
      // The broader `attack_rolls` target is used because the engine does not currently
      // differentiate spell attacks from weapon attacks on the advantage pipeline.
      const advEffect = createEffect(
        nanoid(),
        "advantage",
        "attack_rolls",
        "rounds",
        {
          source: "Innate Sorcery",
          description: "Advantage on your Sorcerer spell attack rolls for 1 minute",
          roundsRemaining: 10,
        },
      );

      // +1 to your Sorcerer spell save DC for 10 rounds.
      const dcEffect = createEffect(
        nanoid(),
        "bonus",
        "spell_save_dc",
        "rounds",
        {
          source: "Innate Sorcery",
          description: "+1 to your Sorcerer spell save DC for 1 minute",
          value: 1,
          roundsRemaining: 10,
        },
      );

      const updatedResources = addActiveEffectsToResources(
        resources as any,
        advEffect,
        dcEffect,
      );

      return {
        success: true,
        summary: "Activates Innate Sorcery! For 1 minute: advantage on Sorcerer spell attacks and +1 to spell save DC.",
        data: {
          abilityName: "Innate Sorcery",
          updatedResources,
        },
      };
    } catch (err: any) {
      return {
        success: false,
        summary: err.message ?? "Failed to activate Innate Sorcery",
        error: "EXECUTION_ERROR",
      };
    }
  }
}
