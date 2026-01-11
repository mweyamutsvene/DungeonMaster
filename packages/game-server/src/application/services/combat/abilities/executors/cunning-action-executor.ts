/**
 * Cunning Action Executor
 * 
 * Handles the Rogue's "Cunning Action" class feature (level 2+).
 * Allows Dash, Disengage, or Hide as a bonus action.
 */

import type { AbilityExecutor, AbilityExecutionContext, AbilityExecutionResult } from "../../../../../domain/abilities/ability-executor.js";

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

    // Get actor ref from params (passed by MonsterAIService)
    const actorRef = params?.actor;
    if (!actorRef) {
      return {
        success: false,
        summary: 'No actor reference in params',
        error: 'MISSING_ACTOR',
      };
    }

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
        summary: 'Hide action not yet implemented',
        error: 'NOT_IMPLEMENTED',
      };
    }

    await services.hide({
      encounterId: context.encounterId,
      actor: actorRef,
    });

    return {
      success: true,
      summary: 'Hid (bonus action via Cunning Action)',
      data: { choice: 'hide', abilityName: 'Cunning Action' },
    };
  }

  private buildActorRef(context: AbilityExecutionContext): any {
    const actor = context.actor;
    const id = actor.getId();

    // Try to determine actor type from creature
    const creature = actor as any;
    if (creature.characterId || (creature as any).__type === 'Character') {
      return { type: 'Character', characterId: id };
    }
    if (creature.npcId || (creature as any).__type === 'NPC') {
      return { type: 'NPC', npcId: id };
    }
    if (creature.monsterId || (creature as any).__type === 'Monster') {
      return { type: 'Monster', monsterId: id };
    }

    // Fallback: assume Character (since Cunning Action is a Rogue feature)
    return { type: 'Character', characterId: id };
  }
}
