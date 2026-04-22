/**
 * Revert Wild Shape Executor
 *
 * Ends an active Wild Shape form as a bonus action.
 * Clears the wild-shape ActiveEffect + tempHp + wildShape* metadata.
 * Does NOT refund the wildShape resource that was spent entering the form.
 *
 * D&D 5e 2024: a druid can revert early (no action/bonus-action cost in 2024,
 * but 2014-style bonus-action implementations also work — this executor
 * treats it as a bonus action for simplicity and symmetry with Wild Shape).
 */

import type {
  AbilityExecutor,
  AbilityExecutionContext,
  AbilityExecutionResult,
} from "../../../../../../domain/abilities/ability-executor.js";
import {
  hasBonusActionAvailable,
  useBonusAction,
  getActiveEffects,
  setActiveEffects,
} from "../../../helpers/resource-utils.js";
import { requireSheet, requireResources } from "../executor-helpers.js";

export class RevertWildShapeExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return normalized === "classdruidrevertwildshape" || normalized === "revertwildshape";
  }

  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const { params } = context;
    const sheetErr = requireSheet(params); if (sheetErr) return sheetErr;
    const resourcesErr = requireResources(params); if (resourcesErr) return resourcesErr;

    const resources = params!.resources;
    const existingEffects = getActiveEffects(resources as any);
    const wildShapeEffect = existingEffects.find(e => e.source === "Wild Shape");
    if (!wildShapeEffect) {
      return {
        success: false,
        summary: "Not currently in Wild Shape form",
        error: "NOT_ACTIVE",
      };
    }

    if (!hasBonusActionAvailable(resources)) {
      return {
        success: false,
        summary: "No bonus action available (reverting requires a bonus action)",
        error: "NO_BONUS_ACTION",
      };
    }

    // Strip wild-shape ActiveEffect.
    const remaining = existingEffects.filter(e => e.source !== "Wild Shape");
    let updatedResources = setActiveEffects(resources as any, remaining);

    updatedResources = useBonusAction(updatedResources);

    // Clear temp HP granted by Wild Shape + beast-form metadata.
    const sanitized: Record<string, unknown> = { ...(updatedResources as Record<string, unknown>) };
    delete sanitized.tempHp;
    delete sanitized.wildShapeActive;
    delete sanitized.wildShapeForm;
    delete sanitized.wildShapeHp;
    delete sanitized.wildShapeHpMax;
    delete sanitized.wildShapeAc;
    delete sanitized.wildShapeAttackBonus;
    delete sanitized.wildShapeDamage;
    delete sanitized.wildShapeMultiattack;
    delete sanitized.wildShapeSpeed;

    return {
      success: true,
      summary: "Reverts from Wild Shape back to normal form.",
      data: {
        abilityName: "Revert Wild Shape",
        updatedResources: sanitized,
      },
    };
  }
}
