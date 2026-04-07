/**
 * Bardic Inspiration Executor (stub)
 *
 * Placeholder for the Bard's Bardic Inspiration class feature.
 * Returns NOT_IMPLEMENTED until full target-selection and dice-pooling logic is built.
 */

import type { AbilityExecutor, AbilityExecutionContext, AbilityExecutionResult } from "../../../../../../domain/abilities/ability-executor.js";

export class BardicInspirationExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return normalized === "classbardbardicinspiration" || normalized === "bardicinspiration";
  }

  async execute(_context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    return {
      success: false,
      summary: "Bardic Inspiration is not yet implemented.",
      error: "NOT_IMPLEMENTED",
      data: { abilityId: "class:bard:bardic-inspiration" },
    };
  }
}
