import type { AbilityExecutor, AbilityExecutionContext, AbilityExecutionResult } from "../../../../../../domain/abilities/ability-executor.js";
import { rollMartialArtsDie } from "../../../../../../domain/rules/martial-arts-die.js";

/**
 * Uncanny Metabolism (Monk Level 2)
 * 
 * When you roll Initiative, you can regain all expended Focus Points.
 * When you do so, roll your Martial Arts die and regain HP equal to
 * your Monk level + the roll.
 * 
 * Once per long rest.
 */
export class UncannyMetabolismExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, '');
    return (
      normalized === 'uncannymetabolism' ||
      normalized === 'classmonkuncannymetabolism'
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

    // Validate level requirement (Monk level 2+)
    const level = (actorRef as any).level || 1;
    if (level < 2) {
      return {
        success: false,
        summary: 'Uncanny Metabolism requires Monk level 2',
        error: 'LEVEL_TOO_LOW',
      };
    }

    // Validate resources - passed via params.resources
    const resources = params?.resources;
    if (!resources) {
      return {
        success: false,
        summary: 'No resources provided for validation',
        error: 'MISSING_RESOURCES',
      };
    }

    const metabolismPool = (resources as any)?.resourcePools?.find((p: any) => p.name === 'uncanny_metabolism');
    
    if (metabolismPool && metabolismPool.current <= 0) {
      return {
        success: false,
        summary: 'Uncanny Metabolism has already been used this long rest',
        error: 'ALREADY_USED',
      };
    }

    const kiPool = (resources as any)?.resourcePools?.find((p: any) => p.name === 'ki');
    
    if (!kiPool) {
      return {
        success: false,
        summary: 'No ki pool found',
        error: 'NO_KI_POOL',
      };
    }

    // Restore all ki points
    const kiRestored = kiPool.max - kiPool.current;
    
    // Roll Martial Arts die and add monk level for HP (scales with level)
    const monkLevel = (actorRef as any).level || 2;
    const martialArtsDieRoll = rollMartialArtsDie(monkLevel);
    const healAmount = monkLevel + martialArtsDieRoll;

    return {
      success: true,
      summary: `${actor.getName()} uses Uncanny Metabolism! Restored ${kiRestored} ki and regained ${healAmount} HP!`,
      data: {
        abilityName: 'Uncanny Metabolism',
        kiRestored,
        healAmount,
        restoreResource: { poolName: 'ki', toMax: true },
        spendResource: { poolName: 'uncanny_metabolism', amount: 1 },
      },
    };
  }
}
