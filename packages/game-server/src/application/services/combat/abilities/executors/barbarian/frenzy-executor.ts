/**
 * Frenzy Executor (Path of the Berserker, Level 3+)
 *
 * D&D 5e 2024: While raging, you can make one extra melee weapon attack
 * as a bonus action on each of your turns.
 *
 * Modes:
 * - Tabletop mode (params.tabletopMode: true): Returns pendingAction for player dice rolls
 * - AI mode: Calls services.attack() directly for auto-resolution
 */

import type {
  AbilityExecutor,
  AbilityExecutionContext,
  AbilityExecutionResult,
} from "../../../../../../domain/abilities/ability-executor.js";
import { FRENZY } from "../../../../../../domain/entities/classes/feature-keys.js";
import { resolveWeaponMastery } from "../../../../../../domain/rules/weapon-mastery.js";
import {
  hasBonusActionAvailable,
  getActiveEffects,
} from "../../../helpers/resource-utils.js";
import { requireActor, requireSheet, requireClassFeature, extractClassInfo } from "../executor-helpers.js";

export class FrenzyExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return (
      normalized === "classbarbarianfrenzy" ||
      normalized === "frenzy" ||
      normalized === "frenzyattack" ||
      normalized === "frenziedstrike"
    );
  }

  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const { services, params, combat, actor } = context;

    const actorErr = requireActor(params);
    if (actorErr) return actorErr;

    const sheetErr = requireSheet(params);
    if (sheetErr) return sheetErr;

    // Must have Frenzy feature (Barbarian level 3+ via Berserker subclass features map)
    const featureErr = requireClassFeature(params, FRENZY, "Frenzy (requires Berserker Barbarian level 3+)");
    if (featureErr) return featureErr;

    // Validate Berserker subclass
    const sheet = params!.sheet as Record<string, unknown>;
    const actorRef = params!.actor as any;
    const subclass =
      (sheet?.subclass as string) ||
      (typeof actorRef?.getSubclass === "function"
        ? (actorRef.getSubclass() as string)
        : undefined) ||
      (params?.subclass as string | undefined);
    if (subclass && !subclass.toLowerCase().includes("berserker")) {
      return {
        success: false,
        summary: "Frenzy requires the Path of the Berserker subclass",
        error: "INVALID_SUBCLASS",
      };
    }

    // Must be raging (check ActiveEffects for Rage source)
    const resources = params?.resources;
    if (resources) {
      const effects = getActiveEffects(resources);
      const isRaging = effects.some((e) => e.source === "Rage");
      if (!isRaging) {
        return {
          success: false,
          summary: "Frenzy requires an active Rage",
          error: "NOT_RAGING",
        };
      }
    }

    // Must have bonus action available
    if (resources && !hasBonusActionAvailable(resources)) {
      return {
        success: false,
        summary: "No bonus action available (Frenzy requires a bonus action)",
        error: "NO_BONUS_ACTION",
      };
    }

    // Must have a target
    const targetRef = params?.target;
    if (!targetRef) {
      return {
        success: false,
        summary: "No target specified for Frenzy attack",
        error: "MISSING_TARGET",
      };
    }

    // Must have taken the Attack action this turn
    if (!combat.hasUsedAction(actor.getId(), "Attack")) {
      return {
        success: false,
        summary: "Frenzy requires using the Attack action first this turn",
        error: "ATTACK_ACTION_REQUIRED",
      };
    }

    // TABLETOP MODE: Return pending action for player dice rolls
    if (params?.tabletopMode) {
      return this.executeTabletopMode(context, actorRef, targetRef, params);
    }

    // AI MODE: Auto-roll attack
    return this.executeAiMode(context, actorRef, targetRef, services, params);
  }

  /**
   * Tabletop mode: Build pending action for player dice rolls.
   * Frenzy attack uses the character's normal melee weapon (full damage modifier).
   */
  private async executeTabletopMode(
    context: AbilityExecutionContext,
    actorRef: any,
    targetRef: any,
    params: Record<string, unknown> | undefined,
  ): Promise<AbilityExecutionResult> {
    const actorId = actorRef.characterId || actorRef.monsterId || actorRef.npcId;
    const targetId =
      (targetRef as any).monsterId ||
      (targetRef as any).characterId ||
      (targetRef as any).npcId;
    const targetName = params?.targetName || "target";

    // Get weapon stats from character sheet
    const sheet = params?.sheet as any;
    const attacks: Array<{
      name: string;
      kind: string;
      attackBonus: number;
      damage: { diceCount: number; diceSides: number; modifier: number };
      properties?: string[];
      mastery?: string;
    }> = sheet?.attacks ?? [];

    // Pick the first melee weapon available
    const meleeWeapon = attacks.find((a) => a.kind === "melee");
    if (!meleeWeapon) {
      return {
        success: false,
        summary: "No melee weapon available for Frenzy attack",
        error: "NO_MELEE_WEAPON",
      };
    }

    const className = params?.className as string | undefined;
    const pendingAction = {
      type: "ATTACK",
      timestamp: new Date(),
      actorId,
      attacker: actorId,
      target: targetId,
      targetId,
      weaponSpec: {
        name: `${meleeWeapon.name} (Frenzy)`,
        kind: "melee" as const,
        attackBonus: meleeWeapon.attackBonus,
        damage: {
          diceCount: meleeWeapon.damage.diceCount,
          diceSides: meleeWeapon.damage.diceSides,
          modifier: meleeWeapon.damage.modifier,
        },
        damageFormula: `${meleeWeapon.damage.diceCount}d${meleeWeapon.damage.diceSides}+${meleeWeapon.damage.modifier}`,
        mastery: resolveWeaponMastery(
          meleeWeapon.name,
          sheet ?? {},
          className,
          meleeWeapon.mastery,
        ),
      },
      bonusAction: "frenzy",
    };

    return {
      success: true,
      summary: `Roll a d20 for Frenzy attack against ${targetName} (no modifiers; server applies bonuses).`,
      requiresPlayerInput: true,
      pendingAction,
      rollType: "attack",
      diceNeeded: "d20",
      data: {
        abilityName: "Frenzy",
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
    services: AbilityExecutionContext["services"],
    params: Record<string, unknown> | undefined,
  ): Promise<AbilityExecutionResult> {
    if (!services.attack) {
      return {
        success: false,
        summary: "Attack service not available",
        error: "MISSING_SERVICE",
      };
    }

    try {
      const targetName = params?.targetName || "target";

      const result = await services.attack({
        encounterId: context.encounterId,
        actor: actorRef,
        target: targetRef,
        attackType: "melee",
        ...(params?.seed !== undefined ? { seed: params.seed } : {}),
      });

      const attackSummary = result.result?.success
        ? `Frenzy attack hit ${targetName} for ${result.result.damage || 0} damage`
        : `Frenzy attack missed ${targetName}`;

      return {
        success: true,
        summary: attackSummary,
        data: {
          abilityName: "Frenzy",
          attackResult: result.result,
          target: targetName,
        },
      };
    } catch (error: any) {
      return {
        success: false,
        summary: `Frenzy attack failed: ${error.message}`,
        error: "ATTACK_FAILED",
      };
    }
  }
}
