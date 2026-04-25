/**
 * Off-hand Attack Executor
 * 
 * Handles two-weapon fighting off-hand attacks as a bonus action.
 * Requires wielding two light melee weapons (or having the Dual Wielder feat).
 * 
 * Modes:
 * - Tabletop mode (params.tabletopMode: true): Returns pendingAction for player dice rolls
 * - AI mode: Calls services.attack() directly for auto-resolution
 */

import type { AbilityExecutor, AbilityExecutionContext, AbilityExecutionResult } from "../../../../../../domain/abilities/ability-executor.js";
import { resolveWeaponMastery } from "../../../../../../domain/rules/weapon-mastery.js";
import { evaluateOffhandAttackEligibility } from "../../../../../../domain/combat/two-weapon-fighting.js";
import { requireActor } from "../executor-helpers.js";

function hasDualWielderFeat(sheet: Record<string, unknown>): boolean {
  const rawFeatIds = [
    ...((sheet.featIds as string[] | undefined) ?? []),
    ...((sheet.feats as string[] | undefined) ?? []),
  ];
  return rawFeatIds.some((feat) => feat.toLowerCase().replace(/[^a-z0-9]+/g, "").includes("dualwielder"));
}

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

    const actorErr = requireActor(params); if (actorErr) return actorErr;

    const actorRef = params!.actor;

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

    // **TABLETOP MODE**: Return pending action for player dice rolls
    if (params?.tabletopMode) {
      return this.executeTabletopMode(context, actorRef, targetRef, params);
    }

    // **AI MODE**: Auto-roll attack via services
    return this.executeAiMode(context, actorRef, targetRef, services, params);
  }

  /**
   * Tabletop mode: Build pending action for player dice rolls.
   * Off-hand attacks do NOT add ability modifier to damage (D&D 5e 2024 rules)
   * unless the character has Two-Weapon Fighting style.
   */
  private async executeTabletopMode(
    context: AbilityExecutionContext,
    actorRef: any,
    targetRef: any,
    params: Record<string, unknown> | undefined,
  ): Promise<AbilityExecutionResult> {
    const actorId = actorRef.characterId || actorRef.monsterId || actorRef.npcId;
    const targetId = (targetRef as any).monsterId || (targetRef as any).characterId || (targetRef as any).npcId;
    const targetName = params?.targetName || 'target';

    // Get weapon stats from character sheet
    const sheet = params?.sheet as any;
    const attacks: Array<{ name: string; kind: string; attackBonus: number; damage: { diceCount: number; diceSides: number; modifier: number } }> = sheet?.attacks ?? [];

    // Pick the off-hand weapon: second weapon if available, first otherwise
    const mainHandWeapon = attacks[0];
    const offhandWeapon = attacks.length > 1 ? attacks[1] : undefined;
    if (!offhandWeapon) {
      return {
        success: false,
        summary: attacks.length < 2
          ? 'Two-weapon fighting requires wielding two weapons'
          : 'No weapon available for off-hand attack',
        error: 'NO_WEAPON',
      };
    }

    // TWF validation: delegate to domain function
    const mainWeaponProps = { properties: (mainHandWeapon as any)?.properties as string[] | undefined };
    const offWeaponProps = { properties: (offhandWeapon as any)?.properties as string[] | undefined };
    const eligibility = evaluateOffhandAttackEligibility({
      mainWeapon: mainWeaponProps,
      offhandWeapon: offWeaponProps,
      hasDualWielderFeat: hasDualWielderFeat(sheet ?? {}),
      hasTakenAttackActionThisTurn: true,
    });
    if (!eligibility.allowed) {
      const errorByReason: Record<string, { summary: string; code: string }> = {
        ATTACK_ACTION_REQUIRED: {
          summary: "Must make a main-hand attack before using off-hand attack",
          code: "ATTACK_ACTION_REQUIRED",
        },
        MISSING_WEAPON: {
          summary: "Two-weapon fighting requires wielding two weapons",
          code: "NO_WEAPON",
        },
        NOT_LIGHT: {
          summary: "Two-weapon fighting requires both weapons to have the Light property",
          code: "NOT_LIGHT",
        },
      };
      const mapped = errorByReason[eligibility.reason] ?? {
        summary: "Off-hand attack requirements not met",
        code: "OFFHAND_NOT_ALLOWED",
      };
      return {
        success: false,
        summary: mapped.summary,
        error: mapped.code,
      };
    }

    // Off-hand attacks use the same attack bonus but NO damage modifier
    // (D&D 5e: you don't add ability modifier to off-hand damage)
    const className = params?.className as string | undefined;
    const pendingAction = {
      type: "ATTACK",
      timestamp: new Date(),
      actorId,
      attacker: actorId,
      target: targetId,
      targetId,
      weaponSpec: {
        name: `${offhandWeapon.name} (Off-hand)`,
        kind: offhandWeapon.kind as "melee" | "ranged",
        attackBonus: offhandWeapon.attackBonus,
        damage: {
          diceCount: offhandWeapon.damage.diceCount,
          diceSides: offhandWeapon.damage.diceSides,
          modifier: 0, // Off-hand: NO ability modifier on damage
        },
        damageFormula: `${offhandWeapon.damage.diceCount}d${offhandWeapon.damage.diceSides}`,
        mastery: resolveWeaponMastery(
          offhandWeapon.name,
          sheet ?? {},
          className,
          (offhandWeapon as any)?.mastery,
        ),
      },
      bonusAction: "offhand-attack",
    };

    return {
      success: true,
      summary: `Roll a d20 for off-hand attack against ${targetName} (no modifiers; server applies bonuses).`,
      requiresPlayerInput: true,
      pendingAction,
      rollType: "attack",
      diceNeeded: "d20",
      data: {
        abilityName: 'Off-hand Attack',
        target: targetName,
      },
    };
  }

  /**
   * AI mode: Auto-roll attack via services.attack()
   */
  private async executeAiMode(
    context: AbilityExecutionContext,
    actorRef: any,
    targetRef: any,
    services: any,
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

    try {
      // Execute off-hand attack
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
