/**
 * Wild Shape Executor
 *
 * Handles the Druid's "Wild Shape" class feature (level 2+).
 * As a bonus action, transform into a standardized beast form.
 * 2024 rules use three forms (Land/Sea/Sky) that scale with druid level.
 *
 * - Spend 1 use of wildShape resource pool
 * - Store beast form stat block as an active effect (HP, AC, attacks)
 * - Uses bonus action
 *
 * D&D 5e 2024 rules.
 */

import type { AbilityExecutor, AbilityExecutionContext, AbilityExecutionResult } from "../../../../../../domain/abilities/ability-executor.js";
import { WILD_SHAPE } from "../../../../../../domain/entities/classes/feature-keys.js";
import { availableBeastForms, getBeastFormStatBlock, type WildShapeBeastForm } from "../../../../../../domain/entities/classes/druid.js";
import { createEffect } from "../../../../../../domain/entities/combat/effects.js";
import {
  hasResourceAvailable,
  spendResourceFromPool,
  hasBonusActionAvailable,
  useBonusAction,
  getActiveEffects,
  addActiveEffectsToResources,
} from "../../../helpers/resource-utils.js";
import {
  createWildShapeFormState,
  applyWildShapeForm,
} from "../../../helpers/wild-shape-form-helper.js";
import { nanoid } from "nanoid";
import { requireSheet, requireResources, requireClassFeature, extractClassInfo } from "../executor-helpers.js";

export class WildShapeExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return normalized === "classdruidwildshape" || normalized === "wildshape";
  }

  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const { params } = context;

    const sheetErr = requireSheet(params); if (sheetErr) return sheetErr;
    const featureErr = requireClassFeature(params, WILD_SHAPE, "Wild Shape (requires Druid level 2+)"); if (featureErr) return featureErr;
    const resourcesErr = requireResources(params); if (resourcesErr) return resourcesErr;

    const resources = params!.resources;
    const { level } = extractClassInfo(params);

    try {
      // Check if already in Wild Shape form
      const existingEffects = getActiveEffects(resources as any);
      const alreadyTransformed = existingEffects.some(e => e.source === "Wild Shape");
      if (alreadyTransformed) {
        return {
          success: false,
          summary: "Already in Wild Shape form!",
          error: "ALREADY_ACTIVE",
        };
      }

      // Check bonus action availability
      if (!hasBonusActionAvailable(resources)) {
        return {
          success: false,
          summary: "No bonus action available (Wild Shape requires a bonus action)",
          error: "NO_BONUS_ACTION",
        };
      }

      // Check uses remaining
      if (!hasResourceAvailable(resources, "wildShape", 1)) {
        return {
          success: false,
          summary: "No Wild Shape uses remaining",
          error: "INSUFFICIENT_USES",
        };
      }

      // Determine which beast form to use (default to Beast of the Land, or from params)
      const forms = availableBeastForms(level);
      if (forms.length === 0) {
        return {
          success: false,
          summary: "Wild Shape not available at this level",
          error: "LEVEL_TOO_LOW",
        };
      }

      const requestedForm = (params?.form as string) ?? "Beast of the Land";
      const form = forms.find(f => f === requestedForm) ?? forms[0];
      const statBlock = getBeastFormStatBlock(form as WildShapeBeastForm, level);

      // Spend 1 use and bonus action
      let updatedResources = spendResourceFromPool(resources, "wildShape", 1);
      updatedResources = useBonusAction(updatedResources);

      // Create an ActiveEffect storing the beast form stat block
      const wildShapeEffect = createEffect(nanoid(), "custom", "custom", "permanent", {
        source: "Wild Shape",
        description: `${form}: AC ${statBlock.ac}, HP ${statBlock.hp}, ATK +${statBlock.attackBonus}, DMG ${statBlock.damage}${statBlock.multiattack ? " (Multiattack)" : ""}`,
      });

      updatedResources = addActiveEffectsToResources(updatedResources, wildShapeEffect);

      const currentRound = Math.max(1, Number(context.combat?.getRound?.() ?? 1));
      const formState = createWildShapeFormState(form, statBlock, context.actor.getId(), currentRound);
      updatedResources = applyWildShapeForm(updatedResources, formState);

      return {
        success: true,
        summary: `Transforms into ${form}! Form HP ${formState.maxHp}, AC ${statBlock.ac}, +${statBlock.attackBonus} to hit, ${statBlock.damage} damage${statBlock.multiattack ? " with Multiattack" : ""}.`,
        resourcesSpent: { wildShape: 1 },
        data: {
          abilityName: "Wild Shape",
          form,
          statBlock,
          wildShapeForm: formState,
          spendResource: { poolName: "wildShape", amount: 1 },
          updatedResources,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        summary: `Wild Shape failed: ${error.message}`,
        error: "EXECUTION_ERROR",
      };
    }
  }
}
