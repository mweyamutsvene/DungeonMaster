/**
 * Wild Shape Executor (stub)
 *
 * Placeholder for the Druid's Wild Shape class feature.
 * Returns NOT_IMPLEMENTED until full stat-block replacement logic is built.
 */

import type { AbilityExecutor, AbilityExecutionContext, AbilityExecutionResult } from "../../../../../../domain/abilities/ability-executor.js";

export class WildShapeExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return normalized === "classdruidwildshape" || normalized === "wildshape";
  }

  async execute(_context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    return {
      success: false,
      summary: "Wild Shape is not yet implemented.",
      error: "NOT_IMPLEMENTED",
      data: { abilityId: "class:druid:wild-shape" },
    };
  }
}
