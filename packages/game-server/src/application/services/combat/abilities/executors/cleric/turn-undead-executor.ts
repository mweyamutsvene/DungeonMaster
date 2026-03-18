/**
 * Turn Undead Executor
 *
 * Handles the Cleric's "Channel Divinity: Turn Undead" class feature (level 2+).
 * As a Magic action, present holy symbol to turn all Undead within 30 feet.
 * Each Undead makes a Wisdom saving throw or becomes Frightened for 1 minute.
 *
 * The executor validates and spends Channel Divinity. The AoE saving throw
 * resolution is handled by the action dispatcher (handleClassAbility) since
 * it requires access to the combat state and saving throw resolver.
 *
 * D&D 5e 2024 rules.
 */

import type {
  AbilityExecutor,
  AbilityExecutionContext,
  AbilityExecutionResult,
} from "../../../../../../domain/abilities/ability-executor.js";
import { ClassFeatureResolver } from "../../../../../../domain/entities/classes/class-feature-resolver.js";

export class TurnUndeadExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return normalized === "classclericturnundead" || normalized === "turnundead";
  }

  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const { params } = context;

    const sheet = params?.sheet;
    const resources = params?.resources;
    const passedClassName = params?.className as string | undefined;
    const passedLevel = params?.level as number | undefined;

    if (!sheet) {
      return { success: false, summary: "No character sheet in params", error: "MISSING_SHEET" };
    }

    const level = passedLevel ?? (sheet as any)?.level ?? 1;
    const className = passedClassName ?? (sheet as any)?.className ?? "";

    // Validate Cleric class + Channel Divinity availability
    if (!ClassFeatureResolver.hasChannelDivinity(sheet as any, className, level)) {
      return {
        success: false,
        summary: "This character does not have Channel Divinity (requires Cleric level 2+)",
        error: "MISSING_FEATURE",
      };
    }

    if (!resources) {
      return { success: false, summary: "No resources provided", error: "MISSING_RESOURCES" };
    }

    try {
      const {
        hasResourceAvailable,
        spendResourceFromPool,
        hasSpentAction,
      } = await import("../../../helpers/resource-utils.js");

      // Check action availability  
      if (hasSpentAction(resources)) {
        return {
          success: false,
          summary: "No action available (Turn Undead requires an action)",
          error: "NO_ACTION",
        };
      }

      // Check Channel Divinity uses
      if (!hasResourceAvailable(resources, "channelDivinity", 1)) {
        return {
          success: false,
          summary: "No Channel Divinity uses remaining (recharges on short/long rest)",
          error: "INSUFFICIENT_USES",
        };
      }

      // Spend Channel Divinity and mark action spent
      const spentPool = spendResourceFromPool(resources, "channelDivinity", 1) as Record<string, unknown>;
      const updatedResources = { ...spentPool, actionSpent: true };

      // Calculate save DC: 8 + proficiency bonus + Wisdom modifier
      const wisdomScore = (sheet as any)?.abilityScores?.wisdom ?? 10;
      const profBonus = ClassFeatureResolver.getProficiencyBonus(sheet as any, level);
      const wisMod = Math.floor((wisdomScore - 10) / 2);
      const saveDC = 8 + profBonus + wisMod;

      return {
        success: true,
        summary: `Channels divinity to Turn Undead! Each Undead within 30 feet must make a DC ${saveDC} Wisdom saving throw or become Frightened.`,
        data: {
          abilityName: "Turn Undead",
          updatedResources,
          aoeEffect: "turnUndead",
          saveDC,
          saveAbility: "wisdom",
          actorLevel: level,
          spendResource: { poolName: "channelDivinity", amount: 1 },
        },
      };
    } catch (err: any) {
      return {
        success: false,
        summary: err.message ?? "Failed to use Turn Undead",
        error: "EXECUTION_ERROR",
      };
    }
  }
}
