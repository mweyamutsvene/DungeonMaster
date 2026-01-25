import type { AbilityExecutor, AbilityExecutionContext, AbilityExecutionResult } from "../../../../../../domain/abilities/ability-executor.js";
import { hasResourceAvailable, spendResourceFromPool } from "../../../helpers/resource-utils.js";

/**
 * Stunning Strike (Monk Level 5)
 * 
 * Once per turn when you hit with a Monk weapon or Unarmed Strike,
 * you can expend 1 Focus Point to attempt a stunning strike.
 * Target makes a Constitution saving throw:
 * - Fail: Stunned until start of your next turn
 * - Success: Speed halved, next attack against them has Advantage
 */
export class StunningStrikeExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, '');
    return (
      normalized === 'stunningstrike' ||
      normalized === 'classmonkstunningstrike'
    );
  }

  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const { services, params, actor } = context;

    const actorRef = params?.actor;
    if (!actorRef) {
      return {
        success: false,
        summary: 'No actor reference in params',
        error: 'MISSING_ACTOR',
      };
    }

    // Validate level requirement (Monk level 5+)
    const level = (actorRef as any).level || 1;
    if (level < 5) {
      return {
        success: false,
        summary: 'Stunning Strike requires Monk level 5',
        error: 'LEVEL_TOO_LOW',
      };
    }

    const targetRef = params?.target;
    if (!targetRef) {
      return {
        success: false,
        summary: 'No target specified for Stunning Strike',
        error: 'MISSING_TARGET',
      };
    }

    // Validate ki points - passed via params.resources
    const resources = params?.resources;
    if (!resources) {
      return {
        success: false,
        summary: 'No resources provided for ki validation',
        error: 'MISSING_RESOURCES',
      };
    }

    // Validate ki availability
    if (!hasResourceAvailable(resources, 'ki', 1)) {
      return {
        success: false,
        summary: 'Insufficient ki for Stunning Strike (requires 1)',
        error: 'INSUFFICIENT_KI',
      };
    }

    // Make an unarmed strike with stunning enhancement
    const attackService = services.attack;
    if (!attackService) {
      return {
        success: false,
        summary: 'Attack service not available',
        error: 'SERVICE_UNAVAILABLE',
      };
    }

    const result = await attackService({
      actorRef,
      targetRef,
      attackType: 'unarmed',
      // Note: The stunning effect would be applied by the attack service
      // based on metadata we provide here
    });

    if (result.success) {
      return {
        success: true,
        summary: `${actor.getName()} uses Stunning Strike!`,
        data: {
          abilityName: 'Stunning Strike',
          kiSpent: 1,
          spendResource: { poolName: 'ki', amount: 1 },
          attackResult: result,
        },
      };
    }

    return {
      success: false,
      summary: 'Stunning Strike attack missed',
      error: 'ATTACK_FAILED',
    };
  }
}
