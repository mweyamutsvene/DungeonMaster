/**
 * Martial Arts Executor
 * 
 * Handles the Monk's "Martial Arts" class feature (level 1+).
 * When you use the Attack action with an unarmed strike or monk weapon on your turn,
 * you can make one unarmed strike as a bonus action.
 */

import type { AbilityExecutor, AbilityExecutionContext, AbilityExecutionResult } from "../../../../../../domain/abilities/ability-executor.js";

/**
 * Executor for Martial Arts (Monk class feature).
 * 
 * Handles:
 * - class:monk:martial-arts
 * - Backward compat: martial_arts, martial_arts_bonus_attack
 * 
 * Prerequisites:
 * - Must have used the Attack action this turn with unarmed strike or monk weapon
 * - Makes 1 unarmed strike as bonus action
 * - No ki cost
 */
export class MartialArtsExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, '');
    return (
      normalized === 'classmonkmartialarts' ||
      normalized === 'martialarts' ||
      normalized === 'martialartsbonus' ||
      normalized === 'martialartsattack'
    );
  }

  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const { services, params, actor } = context;

    // Get actor ref from params (passed by AiTurnOrchestrator)
    const actorRef = params?.actor;
    if (!actorRef) {
      return {
        success: false,
        summary: 'No actor reference in params',
        error: 'MISSING_ACTOR',
      };
    }

    // Get target from params
    const targetRef = params?.target;
    if (!targetRef) {
      return {
        success: false,
        summary: 'No target specified for Martial Arts bonus attack',
        error: 'MISSING_TARGET',
      };
    }

    // Validate level requirement (Monk level 1+)
    const level = (actorRef as any).level || 1;
    if (level < 1) {
      return {
        success: false,
        summary: 'Martial Arts requires Monk level 1',
        error: 'LEVEL_TOO_LOW',
      };
    }

    // Check if attack service is available
    if (!services.attack) {
      return {
        success: false,
        summary: 'Attack service not available',
        error: 'MISSING_SERVICE',
      };
    }

    // Validate that Attack action was used this turn
    if (!context.combat.hasUsedAction(actor.getId(), 'Attack')) {
      return {
        success: false,
        summary: 'Martial Arts bonus strike requires using the Attack action first',
        error: 'ATTACK_ACTION_REQUIRED',
      };
    }

    try {
      // Execute unarmed strike
      const result = await services.attack({
        encounterId: context.encounterId,
        actor: actorRef,
        target: targetRef,
        attackType: 'unarmed', // Special marker for unarmed strike
        ...(params?.seed !== undefined ? { seed: params.seed } : {}),
      });

      const targetName = params?.targetName || 'target';
      const attackSummary = result.result?.success
        ? `Martial Arts bonus unarmed strike hit ${targetName} for ${result.result.damage || 0} damage`
        : `Martial Arts bonus unarmed strike missed ${targetName}`;

      return {
        success: true,
        summary: attackSummary,
        data: {
          abilityName: 'Martial Arts',
          attackResult: result.result,
          target: targetName,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        summary: `Martial Arts bonus attack failed: ${error.message}`,
        error: error.message,
      };
    }
  }
}
