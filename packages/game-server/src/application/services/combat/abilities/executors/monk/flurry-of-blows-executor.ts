/**
 * Flurry of Blows Executor
 * 
 * Handles the Monk's "Flurry of Blows" class feature (level 2+).
 * Immediately after taking the Attack action, spend 1 ki point to make two unarmed strikes as a bonus action.
 * 
 * Supports two modes:
 * - AI mode (default): Auto-rolls attacks and returns results
 * - Tabletop mode (params.tabletopMode: true): Returns pendingAction for player dice rolls
 */

import type { AbilityExecutor, AbilityExecutionContext, AbilityExecutionResult } from "../../../../../../domain/abilities/ability-executor.js";
import { FLURRY_OF_BLOWS } from "../../../../../../domain/entities/classes/feature-keys.js";
import { ClassFeatureResolver } from "../../../../../../domain/entities/classes/class-feature-resolver.js";
import { requireActor, requireResources, requireClassFeature, extractClassInfo } from "../executor-helpers.js";
import { hasResourceAvailable } from "../../../helpers/resource-utils.js";

/**
 * Executor for Flurry of Blows (Monk class feature).
 * 
 * Handles:
 * - class:monk:flurry-of-blows
 * - Backward compat: flurry_of_blows
 * 
 * Prerequisites:
 * - Must have taken the Attack action this turn
 * - Must have at least 1 ki point available
 * - Makes 2 unarmed strikes
 */
export class FlurryOfBlowsExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, '');
    return (
      normalized === 'classmonkflurryofblows' ||
      normalized === 'flurryofblows'
    );
  }

  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const { services, params, actor } = context;

    const actorErr = requireActor(params); if (actorErr) return actorErr;

    // Get target from params
    const targetRef = params?.target;
    if (!targetRef) {
      return {
        success: false,
        summary: 'No target specified for Flurry of Blows',
        error: 'MISSING_TARGET',
      };
    }

    const featureErr = requireClassFeature(params, FLURRY_OF_BLOWS, "Flurry of Blows (requires Monk level 2+)"); if (featureErr) return featureErr;
    const resourcesErr = requireResources(params); if (resourcesErr) return resourcesErr;

    const actorRef = params!.actor;
    const resources = params!.resources;
    const { level } = extractClassInfo(params);

    try {
      // Check ki availability
      if (!hasResourceAvailable(resources, 'ki', 1)) {
        return {
          success: false,
          summary: 'Insufficient ki points for Flurry of Blows (requires 1 ki)',
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

    // **TABLETOP MODE**: Return pending action for player dice rolls
    if (params?.tabletopMode) {
      return this.executeTabletopMode(context, actorRef, targetRef, level, params);
    }

    // **AI MODE**: Auto-roll attacks
    return this.executeAiMode(context, actorRef, targetRef, services, params);
  }

  /**
   * Tabletop mode: Build pending action for player dice rolls
   */
  private async executeTabletopMode(
    context: AbilityExecutionContext,
    actorRef: any,
    targetRef: any,
    level: number,
    params: Record<string, unknown> | undefined,
  ): Promise<AbilityExecutionResult> {
    const actorId = actorRef.characterId || actorRef.monsterId || actorRef.npcId;
    const targetId = targetRef.monsterId || targetRef.characterId || targetRef.npcId;
    const targetName = params?.targetName || 'target';
    const className = params?.className || '';

    // Get unarmed strike stats
    const sheet = params?.sheet || {};
    const unarmedStats = ClassFeatureResolver.getUnarmedStrikeStats(sheet as any, className as string, level);

    // Note: Open Hand Technique is now resolved as an on-hit enhancement in damage text,
    // not upfront in the action declaration (2024 rules: "whenever you hit with Flurry").

    const pendingAction = {
      type: "ATTACK",
      timestamp: new Date(),
      actorId,
      attacker: actorId,
      target: targetId,
      targetId,
      weaponSpec: {
        name: "Flurry of Blows (Unarmed Strike)",
        kind: "melee" as const,
        attackBonus: unarmedStats.attackBonus,
        damage: { 
          diceCount: 1, 
          diceSides: unarmedStats.damageDie, 
          modifier: unarmedStats.damageModifier 
        },
        damageFormula: unarmedStats.damageFormula,
      },
      bonusAction: "flurry-of-blows",
      flurryStrike: 1,
    };

    return {
      success: true,
      summary: `Roll a d20 for attack against ${targetName} (no modifiers; server applies bonuses).`,
      requiresPlayerInput: true,
      pendingAction,
      rollType: "attack",
      diceNeeded: "d20",
      resourcesSpent: { kiPoints: 1 },
      data: {
        abilityName: 'Flurry of Blows',
        target: targetName,
        strike: 1,
      },
    };
  }

  /**
   * AI mode: Auto-roll both attacks
   */
  private async executeAiMode(
    context: AbilityExecutionContext,
    actorRef: any,
    targetRef: any,
    services: AbilityExecutionContext['services'],
    params: Record<string, unknown> | undefined,
  ): Promise<AbilityExecutionResult> {
    // Check if attack service is available
    if (!services.attack) {
      return {
        success: false,
        summary: 'Attack service not available',
        error: 'MISSING_SERVICE',
      };
    }

    // Validate that Attack action was used this turn (only in AI mode)
    if (!context.combat.hasUsedAction(context.actor.getId(), 'Attack')) {
      return {
        success: false,
        summary: 'Flurry of Blows requires using the Attack action first',
        error: 'ATTACK_ACTION_REQUIRED',
      };
    }

    try {
      const attacks: any[] = [];
      const targetName = params?.targetName || 'target';

      // Make first unarmed strike
      const strike1 = await services.attack({
        encounterId: context.encounterId,
        actor: actorRef,
        target: targetRef,
        attackType: 'unarmed',
        ...(params?.seed !== undefined ? { seed: params.seed } : {}),
      });
      attacks.push(strike1.result);

      // Make second unarmed strike
      const strike2 = await services.attack({
        encounterId: context.encounterId,
        actor: actorRef,
        target: targetRef,
        attackType: 'unarmed',
        ...(params?.seed !== undefined ? { seed: params.seed } : {}),
      });
      attacks.push(strike2.result);

      // Build summary
      const hit1 = attacks[0]?.success ? `hit for ${attacks[0].damage || 0} damage` : 'missed';
      const hit2 = attacks[1]?.success ? `hit for ${attacks[1].damage || 0} damage` : 'missed';
      const totalDamage = (attacks[0]?.damage || 0) + (attacks[1]?.damage || 0);

      const summary = `Flurry of Blows: Strike 1 ${hit1}, Strike 2 ${hit2} (${totalDamage} total damage)`;

      return {
        success: true,
        summary,
        resourcesSpent: { kiPoints: 1 },
        data: {
          abilityName: 'Flurry of Blows',
          attacks,
          totalDamage,
          target: targetName,
          kiSpent: 1,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        summary: `Flurry of Blows failed: ${error.message}`,
        error: error.message,
      };
    }
  }
}
