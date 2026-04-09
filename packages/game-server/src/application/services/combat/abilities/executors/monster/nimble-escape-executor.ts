/**
 * Nimble Escape Executor
 * 
 * Handles the Goblin's "Nimble Escape" bonus action feature.
 * Allows Disengage or Hide as a bonus action.
 *
 * Validation:
 * - Actor must be present
 * - Bonus action must be available (when resources provided)
 * - Creature must not be incapacitated (when conditions available)
 *
 * TODO: Add creature-type validation once monsters have a trait/feature system
 * analogous to classHasFeature(). Currently Nimble Escape is a monster trait
 * (Goblin-specific), not a class feature, so the Feature Map pattern doesn't apply.
 */

import type { AbilityExecutor, AbilityExecutionContext, AbilityExecutionResult } from "../../../../../../domain/abilities/ability-executor.js";
import { requireActor } from "../executor-helpers.js";
import { hasBonusActionAvailable } from "../../../helpers/resource-utils.js";

/**
 * Executor for Nimble Escape (Goblin bonus action).
 * 
 * Handles:
 * - monster:bonus:nimble-escape (with choice param)
 * - Backward compat: nimble_escape_disengage, nimble_escape_hide
 */
export class NimbleEscapeExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, '');
    return (
      normalized === 'monsterbonusnimbleescape' ||
      normalized === 'nimbleescape' ||           // LLM-friendly: "Nimble Escape"
      normalized === 'nimbleescapedisengage' ||
      normalized === 'nimbleescapehide'
    );
  }

  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const { services, params } = context;

    const actorErr = requireActor(params); if (actorErr) return actorErr;

    // Check bonus action availability (when resources are provided)
    const resources = params?.resources;
    if (resources && !hasBonusActionAvailable(resources)) {
      return {
        success: false,
        summary: "No bonus action available (Nimble Escape requires a bonus action)",
        error: "NO_BONUS_ACTION",
      };
    }

    // Check for incapacitating conditions (when conditions are available)
    const conditions = params?.conditions as string[] | undefined;
    if (conditions) {
      const lower = conditions.map((c) => c.toLowerCase());
      if (
        lower.includes("incapacitated") ||
        lower.includes("stunned") ||
        lower.includes("paralyzed") ||
        lower.includes("unconscious") ||
        lower.includes("petrified")
      ) {
        return {
          success: false,
          summary: "Cannot use Nimble Escape while incapacitated",
          error: "INCAPACITATED",
        };
      }
    }
    const actorRef = params!.actor;

    // Determine choice: disengage or hide
    let choice = params?.choice as string | undefined;

    // Backward compat: infer from ability ID if no explicit choice
    if (!choice) {
      const normalized = context.abilityId.toLowerCase();
      if (normalized.includes('disengage')) {
        choice = 'disengage';
      } else if (normalized.includes('hide')) {
        choice = 'hide';
      }
    }

    // Default to disengage if ambiguous
    if (!choice || (choice !== 'disengage' && choice !== 'hide')) {
      choice = 'disengage';
    }

    if (choice === 'disengage') {
      if (!services.disengage) {
        return {
          success: false,
          summary: 'Disengage service not available',
          error: 'MISSING_SERVICE',
        };
      }

      await services.disengage({
        encounterId: context.encounterId,
        actor: actorRef,
      });

      return {
        success: true,
        summary: 'Disengaged (bonus action via Nimble Escape)',
        data: { choice: 'disengage', abilityName: 'Nimble Escape' },
      };
    }

    // Hide
    if (!services.hide) {
      return {
        success: false,
        summary: 'Hide action not yet implemented',
        error: 'NOT_IMPLEMENTED',
      };
    }

    await services.hide({
      encounterId: context.encounterId,
      actor: actorRef,
    });

    return {
      success: true,
      summary: 'Hid (bonus action via Nimble Escape)',
      data: { choice: 'hide', abilityName: 'Nimble Escape' },
    };
  }
}
