/**
 * Action Surge Executor
 * 
 * Handles the Fighter's "Action Surge" class feature (level 2+).
 * On your turn, you can take one additional action.
 * Uses per short rest (1 at level 2, 2 at level 17).
 */

import type { AbilityExecutor, AbilityExecutionContext, AbilityExecutionResult } from "../../../../../../domain/abilities/ability-executor.js";
import { ClassFeatureResolver } from "../../../../../../domain/entities/classes/class-feature-resolver.js";

/**
 * Executor for Action Surge (Fighter class feature).
 * 
 * Handles:
 * - class:fighter:action-surge
 * - action-surge, actionsurge
 * 
 * Prerequisites:
 * - Must be a Fighter level 2+
 * - Must have Action Surge uses remaining (recharges on short rest)
 * 
 * Effect:
 * - Grants additional attacks equal to the character's Extra Attack feature
 * - Resets actionSpent flag allowing another action
 */
export class ActionSurgeExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, '');
    return (
      normalized === 'classfighteractionsurge' ||
      normalized === 'actionsurge'
    );
  }

  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const { params } = context;

    // Get actor info from params
    const actorRef = params?.actor;
    const sheet = params?.sheet;
    const resources = params?.resources;
    const passedClassName = params?.className as string | undefined;
    const passedLevel = params?.level as number | undefined;

    if (!actorRef) {
      return {
        success: false,
        summary: 'No actor reference in params',
        error: 'MISSING_ACTOR',
      };
    }

    if (!sheet) {
      return {
        success: false,
        summary: 'No character sheet in params',
        error: 'MISSING_SHEET',
      };
    }

    const level = passedLevel ?? (sheet as any)?.level ?? 1;
    const className = passedClassName ?? (sheet as any)?.className ?? "";

    // Check if character has Action Surge (Fighter level 2+)
    if (!ClassFeatureResolver.hasActionSurge(sheet as any, className, level)) {
      return {
        success: false,
        summary: 'This character does not have Action Surge (requires Fighter level 2+)',
        error: 'MISSING_FEATURE',
      };
    }

    // Validate Action Surge resource pool
    if (!resources) {
      return {
        success: false,
        summary: 'No resources provided for Action Surge validation',
        error: 'MISSING_RESOURCES',
      };
    }

    try {
      // Import resource utils dynamically to avoid circular deps
      const { 
        hasResourceAvailable, 
        spendResourceFromPool, 
        grantAdditionalAction,
        getAttacksAllowedThisTurn,
      } = await import('../../../helpers/resource-utils.js');
      
      // Check Action Surge availability
      if (!hasResourceAvailable(resources, 'actionSurge', 1)) {
        return {
          success: false,
          summary: 'No Action Surge uses remaining (recharges on short rest)',
          error: 'INSUFFICIENT_USES',
        };
      }

      // Spend the Action Surge use
      let updatedResources = spendResourceFromPool(resources, 'actionSurge', 1);
      
      // Calculate how many extra attacks they get from Extra Attack
      const extraAttacks = ClassFeatureResolver.getAttacksPerAction(sheet as any, className, level);
      
      // Grant additional attacks
      updatedResources = grantAdditionalAction(updatedResources, extraAttacks);
      
      const attacksAllowed = getAttacksAllowedThisTurn(updatedResources);

      return {
        success: true,
        summary: `Action Surge! Gained ${extraAttacks} additional attack${extraAttacks > 1 ? 's' : ''} (${attacksAllowed} total attacks remaining).`,
        resourcesSpent: { actionSurge: 1 },
        data: {
          abilityName: 'Action Surge',
          extraAttacks,
          attacksAllowed,
          spendResource: { poolName: 'actionSurge', amount: 1 },
          updatedResources,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        summary: `Action Surge failed: ${error.message}`,
        error: 'EXECUTION_ERROR',
      };
    }
  }
}
