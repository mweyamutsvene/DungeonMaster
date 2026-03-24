/**
 * Step of the Wind Executor
 * 
 * Handles the Monk's "Step of the Wind" class feature (level 2+).
 * Spend 1 ki point to take the Disengage or Dash action as a bonus action.
 * Your jump distance is doubled for the turn.
 */

import type { AbilityExecutor, AbilityExecutionContext, AbilityExecutionResult } from "../../../../../../domain/abilities/ability-executor.js";
import { STEP_OF_THE_WIND } from "../../../../../../domain/entities/classes/feature-keys.js";
import { requireActor, requireResources, requireClassFeature } from "../executor-helpers.js";
import { hasResourceAvailable } from "../../../helpers/resource-utils.js";

/**
 * Executor for Step of the Wind (Monk class feature).
 * 
 * Handles:
 * - class:monk:step-of-the-wind
 * - Backward compat: step_of_the_wind, step_of_the_wind_disengage, step_of_the_wind_dash
 * 
 * Prerequisites:
 * - Must have at least 1 ki point available
 * - Spends 1 ki point
 * - Doubles jump distance for the turn
 */
export class StepOfTheWindExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, '');
    return (
      normalized === 'classmonkstepofthewind' ||
      normalized === 'stepofthewind' ||
      normalized === 'stepofthewinddisengage' ||
      normalized === 'stepofthewinddash'
    );
  }

  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const { services, params, actor } = context;

    const actorErr = requireActor(params); if (actorErr) return actorErr;
    const featureErr = requireClassFeature(params, STEP_OF_THE_WIND, "Step of the Wind (requires Monk level 2+)"); if (featureErr) return featureErr;

    const actorRef = params!.actor;

    // Determine choice: disengage or dash
    let choice = params?.choice as string | undefined;

    // Backward compat: infer from ability ID if no explicit choice
    if (!choice) {
      const normalized = context.abilityId.toLowerCase();
      if (normalized.includes('disengage')) {
        choice = 'disengage';
      } else if (normalized.includes('dash')) {
        choice = 'dash';
      }
    }

    // Default to disengage if ambiguous (safer tactical choice)
    if (!choice || (choice !== 'disengage' && choice !== 'dash')) {
      choice = 'disengage';
    }

    const resourcesErr = requireResources(params); if (resourcesErr) return resourcesErr;

    const resources = params!.resources;

    try {
      // Check ki availability
      if (!hasResourceAvailable(resources, 'ki', 1)) {
        return {
          success: false,
          summary: 'Insufficient ki points for Step of the Wind (requires 1 ki)',
          error: 'INSUFFICIENT_KI',
        };
      }
    } catch (error: any) {
      // If validation fails, return error
      return {
        success: false,
        summary: `Ki validation failed: ${error.message}`,
        error: 'VALIDATION_ERROR',
      };
    }

    // Apply doubled jump distance effect via Combat MovementState
    const combat = context.combat;
    if (!combat) {
      return {
        success: false,
        summary: 'Combat context required for Step of the Wind',
        error: 'MISSING_COMBAT_CONTEXT',
      };
    }

    const actorId = actor.getId();
    
    // Apply doubled jump distance if combat has movement state (not available in tabletop mock)
    if (combat.getMovementState && combat.setJumpMultiplier) {
      if (!combat.getMovementState(actorId) && combat.initializeMovementState) {
        const actorPos = (combat.getPosition ? combat.getPosition(actorId) : null) || { x: 0, y: 0 };
        const speed = actor.getSpeed ? actor.getSpeed() : 30;
        combat.initializeMovementState(actorId, actorPos, speed);
      }
      combat.setJumpMultiplier(actorId, 2);
    }

    try {
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
          summary: 'Disengaged (bonus action via Step of the Wind, spent 1 ki, jump distance doubled)',
          resourcesSpent: { kiPoints: 1 },
          data: {
            abilityName: 'Step of the Wind',
            choice: 'disengage',
            kiSpent: 1,
            jumpDoubled: true,
            jumpMultiplier: 2,
            spendResource: { poolName: 'ki', amount: 1 },
          },
        };
      }

      // Dash
      if (!services.dash) {
        return {
          success: false,
          summary: 'Dash service not available',
          error: 'MISSING_SERVICE',
        };
      }

      await services.dash({
        encounterId: context.encounterId,
        actor: actorRef,
      });

      return {
        success: true,
        summary: 'Dashed (bonus action via Step of the Wind, spent 1 ki, jump distance doubled)',
        resourcesSpent: { kiPoints: 1 },
        data: {
          abilityName: 'Step of the Wind',
          choice: 'dash',
          kiSpent: 1,
          jumpDoubled: true,
          jumpMultiplier: 2,
          spendResource: { poolName: 'ki', amount: 1 },
        },
      };
    } catch (error: any) {
      return {
        success: false,
        summary: `Step of the Wind failed: ${error.message}`,
        error: error.message,
      };
    }
  }
}
