/**
 * Quickened Spell Executor (stub)
 *
 * Placeholder for the Sorcerer's Quickened Spell metamagic option.
 * Returns NOT_IMPLEMENTED until full metamagic integration is built.
 */

import type { AbilityExecutor, AbilityExecutionContext, AbilityExecutionResult } from "../../../../../../domain/abilities/ability-executor.js";

export class QuickenedSpellExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return normalized === "classsorcererquickenedspell" || normalized === "quickenedspell" || normalized === "quickenspell";
  }

  async execute(_context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    return {
      success: false,
      summary: "Quickened Spell is not yet implemented.",
      error: "NOT_IMPLEMENTED",
      data: { abilityId: "class:sorcerer:quickened-spell" },
    };
  }
}
