/**
 * Bardic Inspiration Executor
 *
 * Handles the Bard's "Bardic Inspiration" class feature.
 * As a bonus action, grant an ally a Bardic Inspiration die they can add
 * to one ability check, attack roll, or saving throw within the next 10 minutes.
 *
 * Die size scales with bard level: d6 (1-4), d8 (5-9), d10 (10-14), d12 (15+).
 * Uses per long rest = CHA modifier (minimum 1). Font of Inspiration (level 5) recharges on short rest.
 *
 * D&D 5e 2024 rules.
 */

import type { AbilityExecutor, AbilityExecutionContext, AbilityExecutionResult } from "../../../../../../domain/abilities/ability-executor.js";
import { BARDIC_INSPIRATION } from "../../../../../../domain/entities/classes/feature-keys.js";
import { bardicInspirationDieForLevel } from "../../../../../../domain/entities/classes/bard.js";
import { createEffect } from "../../../../../../domain/entities/combat/effects.js";
import {
  hasResourceAvailable,
  spendResourceFromPool,
  hasBonusActionAvailable,
  useBonusAction,
  addActiveEffectsToResources,
} from "../../../helpers/resource-utils.js";
import { nanoid } from "nanoid";
import { requireSheet, requireResources, requireClassFeature, extractClassInfo } from "../executor-helpers.js";

export class BardicInspirationExecutor implements AbilityExecutor {
  readonly allowsAllyTarget = true;

  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return normalized === "classbardbardicinspiration" || normalized === "bardicinspiration";
  }

  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const { params } = context;

    const sheetErr = requireSheet(params); if (sheetErr) return sheetErr;
    const featureErr = requireClassFeature(params, BARDIC_INSPIRATION, "Bardic Inspiration (requires Bard class)"); if (featureErr) return featureErr;
    const resourcesErr = requireResources(params); if (resourcesErr) return resourcesErr;

    const resources = params!.resources;
    const { level } = extractClassInfo(params);

    try {
      // Check bonus action availability
      if (!hasBonusActionAvailable(resources)) {
        return {
          success: false,
          summary: "No bonus action available (Bardic Inspiration requires a bonus action)",
          error: "NO_BONUS_ACTION",
        };
      }

      // Check uses remaining
      if (!hasResourceAvailable(resources, "bardicInspiration", 1)) {
        return {
          success: false,
          summary: "No Bardic Inspiration uses remaining",
          error: "INSUFFICIENT_USES",
        };
      }

      const dieSides = bardicInspirationDieForLevel(level);

      // Spend 1 use and bonus action
      let updatedResources = spendResourceFromPool(resources, "bardicInspiration", 1);
      updatedResources = useBonusAction(updatedResources);

      // Create an ActiveEffect granting the Bardic Inspiration die
      // The target creature (params.targetId or the ally) receives this effect.
      // For now we store it on the caster's resources — the combat service
      // will transfer it to the target when target selection is resolved.
      const inspirationEffect = createEffect(nanoid(), "bonus", "custom", "until_triggered", {
        diceValue: { count: 1, sides: dieSides },
        source: "Bardic Inspiration",
        description: `Add 1d${dieSides} to one ability check, attack roll, or saving throw`,
      });

      updatedResources = addActiveEffectsToResources(updatedResources, inspirationEffect);

      const targetName = (params?.targetName as string) ?? "an ally";

      return {
        success: true,
        summary: `Grants Bardic Inspiration (1d${dieSides}) to ${targetName}!`,
        resourcesSpent: { bardicInspiration: 1 },
        data: {
          abilityName: "Bardic Inspiration",
          dieSides,
          targetName,
          spendResource: { poolName: "bardicInspiration", amount: 1 },
          updatedResources,
          inspirationEffect,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        summary: `Bardic Inspiration failed: ${error.message}`,
        error: "EXECUTION_ERROR",
      };
    }
  }
}
