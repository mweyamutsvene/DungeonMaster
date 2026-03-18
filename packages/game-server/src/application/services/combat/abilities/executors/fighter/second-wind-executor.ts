/**
 * Second Wind Executor
 * 
 * Handles the Fighter's "Second Wind" class feature (level 1+).
 * As a bonus action, regain 1d10 + Fighter level HP.
 * 1 use per short rest.
 */

import type { AbilityExecutor, AbilityExecutionContext, AbilityExecutionResult } from "../../../../../../domain/abilities/ability-executor.js";
import { ClassFeatureResolver } from "../../../../../../domain/entities/classes/class-feature-resolver.js";
import { SeededDiceRoller } from "../../../../../../domain/rules/dice-roller.js";

/**
 * Executor for Second Wind (Fighter class feature).
 * 
 * Handles:
 * - class:fighter:second-wind
 * - second-wind, secondwind
 * 
 * Prerequisites:
 * - Must be a Fighter level 1+
 * - Must have Second Wind uses remaining (recharges on short rest)
 * 
 * Effect:
 * - Heals 1d10 + Fighter level HP
 * - Consumes bonus action
 */
export class SecondWindExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, '');
    return (
      normalized === 'classfightersecondwind' ||
      normalized === 'secondwind'
    );
  }

  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const { params, sessionId, encounterId } = context;

    // Get actor info from params
    const actorRef = params?.actor;
    const sheet = params?.sheet;
    const resources = params?.resources;
    const combatantState = params?.combatantState;
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

    // Check if character is a Fighter (Second Wind is available at level 1)
    if (!ClassFeatureResolver.isFighter(sheet as any, className)) {
      return {
        success: false,
        summary: 'This character does not have Second Wind (requires Fighter class)',
        error: 'MISSING_FEATURE',
      };
    }

    // Validate Second Wind resource pool
    if (!resources) {
      return {
        success: false,
        summary: 'No resources provided for Second Wind validation',
        error: 'MISSING_RESOURCES',
      };
    }

    try {
      // Import resource utils dynamically to avoid circular deps
      const { 
        hasResourceAvailable, 
        spendResourceFromPool, 
        hasBonusActionAvailable,
        useBonusAction,
      } = await import('../../../helpers/resource-utils.js');
      
      // Check Second Wind availability
      if (!hasResourceAvailable(resources, 'secondWind', 1)) {
        return {
          success: false,
          summary: 'No Second Wind uses remaining (recharges on short rest)',
          error: 'INSUFFICIENT_USES',
        };
      }

      // Check bonus action availability
      if (!hasBonusActionAvailable(resources)) {
        return {
          success: false,
          summary: 'No bonus action available (Second Wind requires a bonus action)',
          error: 'NO_BONUS_ACTION',
        };
      }

      // Roll healing: 1d10 + Fighter level
      const seed = Date.now();
      const dice = new SeededDiceRoller(seed);
      const healResult = dice.rollDie(10, 1, 0);
      const healRoll = healResult.total;
      const totalHealing = healRoll + level;

      // Calculate actual healing
      const currentHp = (combatantState as any)?.hpCurrent ?? (sheet as any)?.currentHp ?? 0;
      const maxHp = (combatantState as any)?.hpMax ?? (sheet as any)?.maxHp ?? 10;
      const newHp = Math.min(maxHp, currentHp + totalHealing);
      const actualHealing = newHp - currentHp;

      // Spend the Second Wind use and bonus action
      let updatedResources = spendResourceFromPool(resources, 'secondWind', 1);
      updatedResources = useBonusAction(updatedResources);

      return {
        success: true,
        summary: `Second Wind! Healed ${actualHealing} HP (rolled ${healRoll} + ${level} level = ${totalHealing}). Now at ${newHp}/${maxHp} HP.`,
        resourcesSpent: { secondWind: 1 },
        data: {
          abilityName: 'Second Wind',
          healRoll,
          levelBonus: level,
          totalHealing,
          actualHealing,
          newHp,
          maxHp,
          spendResource: { poolName: 'secondWind', amount: 1 },
          updatedResources,
          hpUpdate: { hpCurrent: newHp },
        },
      };
    } catch (error: any) {
      return {
        success: false,
        summary: `Second Wind failed: ${error.message}`,
        error: 'EXECUTION_ERROR',
      };
    }
  }
}
