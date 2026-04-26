/**
 * Revert Wild Shape Executor
 *
 * Ends an active Wild Shape form as a free action.
 * Clears structured wild-shape form state and legacy wild-shape metadata.
 * Does NOT refund the wildShape resource that was spent entering the form.
 */

import type {
  AbilityExecutor,
  AbilityExecutionContext,
  AbilityExecutionResult,
} from "../../../../../../domain/abilities/ability-executor.js";
import {
  normalizeResources,
} from "../../../helpers/resource-utils.js";
import {
  removeWildShapeForm,
  getWildShapeForm,
} from "../../../helpers/wild-shape-form-helper.js";
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

    const resources = normalizeResources(params!.resources);
    const form = getWildShapeForm(resources);
    if (!form) {
      return {
        success: false,
        summary: "Not currently in Wild Shape form",
        error: "NOT_ACTIVE",
      };
    }

    const sanitized = removeWildShapeForm(resources);

    return {
      success: true,
      summary: `Reverts from ${form.formName} back to normal form.`,
      data: {
        abilityName: "Revert Wild Shape",
        updatedResources: sanitized,
      },
    };
  }
}
