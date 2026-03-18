/**
 * Nimble Escape Executor
 * 
 * Handles the Goblin's "Nimble Escape" bonus action feature.
 * Allows Disengage or Hide as a bonus action.
 */

import type { AbilityExecutor, AbilityExecutionContext, AbilityExecutionResult } from "../../../../../../domain/abilities/ability-executor.js";

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

      // Get actor ref from params (passed by AiTurnOrchestrator)
      const actorRef = params?.actor;
      if (!actorRef) {
        return {
          success: false,
          summary: 'No actor reference in params',
          error: 'MISSING_ACTOR',
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

    // Get actor ref from params
    const actorRef = params?.actor;
    if (!actorRef) {
      return {
        success: false,
        summary: 'No actor reference in params',
        error: 'MISSING_ACTOR',
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
