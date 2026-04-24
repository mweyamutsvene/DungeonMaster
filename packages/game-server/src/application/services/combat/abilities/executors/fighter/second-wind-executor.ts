/**
 * Second Wind Executor
 * 
 * Handles the Fighter's "Second Wind" class feature (level 1+).
 * As a bonus action, regain 1d10 + Fighter level HP.
 * 1 use per short rest.
 */

import type { AbilityExecutor, AbilityExecutionContext, AbilityExecutionResult } from "../../../../../../domain/abilities/ability-executor.js";
import { SECOND_WIND, TACTICAL_SHIFT } from "../../../../../../domain/entities/classes/feature-keys.js";
import { SeededDiceRoller } from "../../../../../../domain/rules/dice-roller.js";
import { createEffect } from "../../../../../../domain/entities/combat/effects.js";
import { classHasFeature } from "../../../../../../domain/entities/classes/registry.js";
import { nanoid } from "nanoid";
import { requireActor, requireSheet, requireResources, requireClassFeature, extractClassInfo } from "../executor-helpers.js";
import { hasResourceAvailable, spendResourceFromPool, hasBonusActionAvailable, useBonusAction, addActiveEffectsToResources } from "../../../helpers/resource-utils.js";

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

    const actorErr = requireActor(params); if (actorErr) return actorErr;
    const sheetErr = requireSheet(params); if (sheetErr) return sheetErr;
    const featureErr = requireClassFeature(params, SECOND_WIND, "Second Wind (requires Fighter class)"); if (featureErr) return featureErr;
    const resourcesErr = requireResources(params); if (resourcesErr) return resourcesErr;

    const actorRef = params!.actor;
    const sheet = params!.sheet;
    const resources = params!.resources;
    const combatantState = params?.combatantState;
    const { level, className } = extractClassInfo(params);

    try {
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

      // Tactical Shift (Fighter L5+, 2024 PHB): Using Second Wind also grants a speed bonus
      // equal to half your base walking speed until the end of your turn, and that movement
      // doesn't provoke opportunity attacks. Implemented here as a speed-modifier effect;
      // the "no OA" clause is currently approximated by the speed boost alone.
      let tacticalShiftApplied = false;
      if (classHasFeature(className, TACTICAL_SHIFT, level)) {
        const baseSpeed = typeof (sheet as any)?.speed === 'number' ? (sheet as any).speed : 30;
        const bonusSpeed = Math.floor(baseSpeed / 2);
        if (bonusSpeed > 0) {
          const shiftEffect = createEffect(
            nanoid(),
            "speed_modifier",
            "speed",
            "until_end_of_turn",
            {
              source: "Tactical Shift",
              description: `+${bonusSpeed} ft speed this turn (Second Wind free movement)`,
              value: bonusSpeed,
            },
          );
          updatedResources = addActiveEffectsToResources(updatedResources, shiftEffect);
          tacticalShiftApplied = true;
        }
      }

      const shiftNote = tacticalShiftApplied ? " Tactical Shift grants bonus movement this turn." : "";

      return {
        success: true,
        summary: `Second Wind! Healed ${actualHealing} HP (rolled ${healRoll} + ${level} level = ${totalHealing}). Now at ${newHp}/${maxHp} HP.${shiftNote}`,
        resourcesSpent: { secondWind: 1 },
        data: {
          abilityName: 'Second Wind',
          healRoll,
          levelBonus: level,
          totalHealing,
          actualHealing,
          newHp,
          maxHp,
          tacticalShiftApplied,
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
