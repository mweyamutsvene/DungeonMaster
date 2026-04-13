/**
 * Cunning Action Executor
 * 
 * Handles the Rogue's "Cunning Action" class feature (level 2+).
 * Allows Dash, Disengage, or Hide as a bonus action.
 */

import type { AbilityExecutor, AbilityExecutionContext, AbilityExecutionResult } from "../../../../../../domain/abilities/ability-executor.js";
import { CUNNING_ACTION } from "../../../../../../domain/entities/classes/feature-keys.js";
import { requireActor, requireClassFeature } from "../executor-helpers.js";

/**
 * Executor for Cunning Action (Rogue class feature).
 * 
 * Handles:
 * - class:rogue:cunning-action (with choice param)
 * - Backward compat: cunning_action_dash, cunning_action_disengage, cunning_action_hide
 */
export class CunningActionExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, '');
    return (
      normalized === 'classroguecunningaction' ||
      normalized === 'cunningaction' ||          // LLM-friendly: "Cunning Action"
      normalized === 'cunningactiondash' ||
      normalized === 'cunningactiondisengage' ||
      normalized === 'cunningactionhide'
    );
  }

  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const { services, params } = context;

    const actorErr = requireActor(params); if (actorErr) return actorErr;
    const featureErr = requireClassFeature(params, CUNNING_ACTION, "Cunning Action (requires Rogue level 2+)"); if (featureErr) return featureErr;

    const actorRef = params!.actor;

    // Determine choice: dash, disengage, or hide
    let choice = params?.choice as string | undefined;

    // Backward compat: infer from ability ID if no explicit choice
    if (!choice) {
      const normalized = context.abilityId.toLowerCase();
      if (normalized.includes('dash')) {
        choice = 'dash';
      } else if (normalized.includes('disengage')) {
        choice = 'disengage';
      } else if (normalized.includes('hide')) {
        choice = 'hide';
      }
    }

    // Infer from original text input (e.g., "cunning action hide")
    if (!choice && params?.text) {
      const textLower = String(params.text).toLowerCase();
      if (textLower.includes('dash')) {
        choice = 'dash';
      } else if (textLower.includes('hide')) {
        choice = 'hide';
      } else if (textLower.includes('disengage')) {
        choice = 'disengage';
      }
    }

    // Default to disengage if ambiguous (safest tactical choice)
    if (!choice || !['dash', 'disengage', 'hide'].includes(choice)) {
      choice = 'disengage';
    }

    if (choice === 'dash') {
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
        summary: 'Dashed (bonus action via Cunning Action)',
        data: { choice: 'dash', abilityName: 'Cunning Action' },
      };
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
        summary: 'Disengaged (bonus action via Cunning Action)',
        data: { choice: 'disengage', abilityName: 'Cunning Action' },
      };
    }

    // Hide
    if (!services.hide) {
      return {
        success: false,
        summary: 'Hide service not available',
        error: 'MISSING_SERVICE',
      };
    }

    const hideResult = await services.hide({
      encounterId: context.encounterId,
      actor: actorRef,
    });

    const stealthRoll: number | undefined = hideResult?.result?.stealthRoll;
    const hideSucceeded: boolean = hideResult?.result?.success ?? false;
    const summary = hideSucceeded
      ? `Hides successfully! Stealth roll: ${stealthRoll ?? '?'} — now Hidden (bonus action via Cunning Action)`
      : `Hide attempt failed — Stealth roll: ${stealthRoll ?? '?'}, spotted by an observer (bonus action consumed)`;

    return {
      success: true, // Bonus action was consumed regardless of hide outcome
      summary,
      data: {
        choice: 'hide',
        abilityName: 'Cunning Action',
        stealthRoll,
        hideSucceeded,
      },
    };
  }
}
