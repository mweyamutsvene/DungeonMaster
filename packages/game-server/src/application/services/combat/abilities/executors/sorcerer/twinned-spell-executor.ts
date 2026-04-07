/**
 * Twinned Spell Executor (stub)
 *
 * Placeholder for the Sorcerer's Twinned Spell metamagic option.
 * Returns NOT_IMPLEMENTED until full metamagic integration is built.
 */

import type { AbilityExecutor, AbilityExecutionContext, AbilityExecutionResult } from "../../../../../../domain/abilities/ability-executor.js";

export class TwinnedSpellExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return normalized === "classsorcerertwinnedspell" || normalized === "twinnedspell" || normalized === "twinspell";
  }

  async execute(_context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    return {
      success: false,
      summary: "Twinned Spell is not yet implemented.",
      error: "NOT_IMPLEMENTED",
      data: { abilityId: "class:sorcerer:twinned-spell" },
    };
  }
}
