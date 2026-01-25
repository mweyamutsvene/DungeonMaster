/**
 * Off-hand Attack Executor
 * 
 * Handles two-weapon fighting off-hand attacks as a bonus action.
 * Requires wielding two light melee weapons (or having the Dual Wielder feat).
 */

import type { AbilityExecutor, AbilityExecutionContext, AbilityExecutionResult } from "../../../../../../domain/abilities/ability-executor.js";

/**
 * Executor for off-hand attack (two-weapon fighting).
 * 
 * Handles:
 * - base:bonus:offhand-attack
 * - Backward compat: offhand_attack
 */
export class OffhandAttackExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, '');
    return (
      normalized === 'basebonusoffhandattack' ||
      normalized === 'offhandattack' ||
      normalized === 'offhand'
    );
  }

  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const { services, params, combat, actor } = context;

    // Get actor ref from params (passed by AiTurnOrchestrator)
    const actorRef = params?.actor;
    if (!actorRef) {
      return {
        success: false,
        summary: 'No actor reference in params',
        error: 'MISSING_ACTOR',
      };
    }

    // Validate Attack action prerequisite
    if (!combat.hasUsedAction(actor.getId(), 'Attack')) {
      return {
        success: false,
        summary: 'Must make a main-hand attack before using off-hand attack',
        error: 'ATTACK_ACTION_REQUIRED',
      };
    }

    // Get target from params
    const targetRef = params?.target;
    if (!targetRef) {
      return {
        success: false,
        summary: 'No target specified for off-hand attack',
        error: 'MISSING_TARGET',
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

    // TODO: Validate weapon properties (requires Equipment system integration)
    // - Both weapons must be light (or have Dual Wielder feat)
    // - Off-hand attack doesn't add ability modifier to damage (unless Fighting Style: Two-Weapon Fighting)
    // Example implementation:
    // const mainHandWeapon = actorRef.equipment?.mainHand;
    // const offhandWeapon = actorRef.equipment?.offhand;
    // if (!mainHandWeapon?.properties?.includes('Light') || !offhandWeapon?.properties?.includes('Light')) {
    //   return { success: false, error: 'WEAPONS_NOT_LIGHT' };
    // }

    try {
      // Execute off-hand attack
      // Note: Off-hand attacks don't add ability modifier to damage by default
      const result = await services.attack({
        encounterId: context.encounterId,
        actor: actorRef,
        target: targetRef,
        attackType: 'offhand', // Special marker for off-hand attack
        ...(params?.seed !== undefined ? { seed: params.seed } : {}),
      });

      const attackSummary = result.result?.success
        ? `Off-hand attack hit ${params?.targetName || 'target'} for ${result.result.damage || 0} damage`
        : `Off-hand attack missed ${params?.targetName || 'target'}`;

      return {
        success: true,
        summary: attackSummary,
        data: {
          abilityName: 'Off-hand Attack',
          attackResult: result.result,
          target: params?.targetName,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        summary: `Off-hand attack failed: ${error.message}`,
        error: error.message,
      };
    }
  }
}
