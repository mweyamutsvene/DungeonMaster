import type { AbilityExecutor, AbilityExecutionContext, AbilityExecutionResult } from "../../../../../../domain/abilities/ability-executor.js";

/**
 * Deflect Attacks (Monk Level 3)
 * 
 * When hit by an attack roll, use Reaction to reduce damage by 1d10 + Dexterity modifier + Monk level.
 * If damage reduced to 0, can spend 1 Focus Point to immediately redirect the attack
 * at another creature within 5 feet (uses your attack bonus).
 * 
 * At Level 13: Deflect Energy - extends to all damage types except Force.
 */
export class DeflectAttacksExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, '');
    return (
      normalized === 'deflectattacks' ||
      normalized === 'classmonkdeflectattacks' ||
      normalized === 'deflectenergy' ||
      normalized === 'classmonkdeflectenergy'
    );
  }

  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const { actor, params } = context;

    const actorRef = params?.actor;
    if (!actorRef) {
      return {
        success: false,
        summary: 'No actor reference in params',
        error: 'MISSING_ACTOR',
      };
    }

    // Validate level requirement (Monk level 3+, extends to all damage at 13+)
    const level = (actorRef as any).level || 1;
    if (level < 3) {
      return {
        success: false,
        summary: 'Deflect Attacks requires Monk level 3',
        error: 'LEVEL_TOO_LOW',
      };
    }

    // Get incoming damage from params
    const incomingDamage = params?.incomingDamage as number;
    if (incomingDamage === undefined) {
      return {
        success: false,
        summary: 'No incoming damage specified',
        error: 'MISSING_DAMAGE',
      };
    }

    // Roll deflection amount: 1d10 + Dex modifier + Monk level
    const deflectionRoll = Math.floor(Math.random() * 10) + 1;
    const dexScore = (actorRef as any).abilityScores?.dexterity || 10;
    const dexModifier = Math.floor((dexScore - 10) / 2);
    const monkLevel = (actorRef as any).level || 3;
    const deflectionAmount = deflectionRoll + dexModifier + monkLevel;

    const damageAfterDeflection = Math.max(0, incomingDamage - deflectionAmount);
    const damageBlocked = incomingDamage - damageAfterDeflection;

    // If damage reduced to 0, offer redirect option
    if (damageAfterDeflection === 0) {
      // Check if player wants to spend ki to redirect
      const shouldRedirect = params?.redirect === true;
      
      if (shouldRedirect) {
        // Validate resources
        const resources = params?.resources;
        if (!resources) {
          return {
            success: true,
            summary: `${actor.getName()} deflects ${damageBlocked} damage! (Cannot redirect - no resources provided)`,
            data: {
              abilityName: 'Deflect Attacks',
              damageBlocked,
              damageRemaining: 0,
            },
          };
        }

        // Import resource utils
        const { hasResourceAvailable } = await import('../../../helpers/resource-utils.js');
        
        if (!hasResourceAvailable(resources, 'ki', 1)) {
          return {
            success: true,
            summary: `${actor.getName()} deflects ${damageBlocked} damage! (Insufficient ki to redirect)`,
            data: {
              abilityName: 'Deflect Attacks',
              damageBlocked,
              damageRemaining: 0,
            },
          };
        }

        // Redirect attack (would need target and attack service)
        const targetRef = params?.redirectTarget;
        if (!targetRef || !context.services.attack) {
          return {
            success: true,
            summary: `${actor.getName()} deflects ${damageBlocked} damage and prepares to redirect!`,
            data: {
              abilityName: 'Deflect Attacks',
              damageBlocked,
              damageRemaining: 0,
              spendResource: { poolName: 'ki', amount: 1 },
              canRedirect: true,
            },
          };
        }

        // Execute redirect attack
        const redirectResult = await context.services.attack({
          encounterId: context.encounterId,
          actor: actorRef,
          target: targetRef,
          attackType: 'redirect',
        });

        return {
          success: true,
          summary: `${actor.getName()} deflects and redirects the attack!`,
          data: {
            abilityName: 'Deflect Attacks',
            damageBlocked,
            damageRemaining: 0,
            spendResource: { poolName: 'ki', amount: 1 },
            redirectAttack: redirectResult,
          },
        };
      }
    }

    return {
      success: true,
      summary: `${actor.getName()} deflects ${damageBlocked} damage (${damageAfterDeflection} remaining)`,
      data: {
        abilityName: 'Deflect Attacks',
        damageBlocked,
        damageRemaining: damageAfterDeflection,
        deflectionRoll,
        deflectionAmount,
      },
    };
  }
}
