/**
 * Divine Spark Executor (Cleric Channel Divinity option, L2+, 2024 PHB).
 *
 * RAW 2024:
 *  - Magic action (action)
 *  - Spend 1 Channel Divinity use
 *  - Target one creature within 60 ft. Roll radiant/necrotic dice based on Cleric level.
 *  - Choose: deal damage (Constitution save for half) OR restore HP.
 *  - Damage/healing: Cleric level-scaled: 1d8 + WIS mod (L1-4), 2d8 + WIS (L5-9),
 *    3d8 + WIS (L10-13), 4d8 + WIS (L14+).
 *
 * Implementation scope: spends Channel Divinity + action and returns roll data.
 * Caller (dispatcher) applies damage or healing based on params.mode ("damage" | "heal")
 * and params.target. Saving throw resolution for damage is the dispatcher's job.
 */

import type {
  AbilityExecutor,
  AbilityExecutionContext,
  AbilityExecutionResult,
} from "../../../../../../domain/abilities/ability-executor.js";
import { CHANNEL_DIVINITY } from "../../../../../../domain/entities/classes/feature-keys.js";
import { proficiencyBonusByLevel } from "../../../../../../domain/entities/classes/class-feature-resolver.js";
import { SeededDiceRoller } from "../../../../../../domain/rules/dice-roller.js";
import { requireSheet, requireResources, requireClassFeature, extractClassInfo } from "../executor-helpers.js";
import { hasResourceAvailable, spendResourceFromPool, hasSpentAction } from "../../../helpers/resource-utils.js";

function divineSparkDiceCount(level: number): number {
  if (level >= 14) return 4;
  if (level >= 10) return 3;
  if (level >= 5) return 2;
  return 1;
}

export class DivineSparkExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return normalized === "classclericdivinespark" || normalized === "divinespark";
  }

  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const { params } = context;

    const sheetErr = requireSheet(params); if (sheetErr) return sheetErr;
    const featureErr = requireClassFeature(params, CHANNEL_DIVINITY, "Channel Divinity (requires Cleric level 2+)"); if (featureErr) return featureErr;
    const resourcesErr = requireResources(params); if (resourcesErr) return resourcesErr;

    const sheet = params!.sheet;
    const resources = params!.resources;
    const { level } = extractClassInfo(params);

    try {
      if (hasSpentAction(resources)) {
        return { success: false, summary: "No action available (Divine Spark requires an action)", error: "NO_ACTION" };
      }

      if (!hasResourceAvailable(resources, "channelDivinity:cleric", 1)) {
        return { success: false, summary: "No Channel Divinity uses remaining (recharges on short/long rest)", error: "INSUFFICIENT_USES" };
      }

      // Determine mode: damage (default) or heal. Caller passes `choice` or `mode` param.
      const rawMode = typeof params?.choice === "string" ? params.choice : typeof params?.mode === "string" ? params.mode : "damage";
      const mode: "damage" | "heal" = rawMode === "heal" || rawMode === "restore" ? "heal" : "damage";

      // Damage type for damage mode — necrotic or radiant (caller decision; default radiant).
      const damageType = typeof params?.damageType === "string" && params.damageType === "necrotic" ? "necrotic" : "radiant";

      // Roll Nd8 + WIS mod
      const wisdomScore = (sheet as any)?.abilityScores?.wisdom ?? 10;
      const wisMod = Math.floor((wisdomScore - 10) / 2);
      const diceCount = divineSparkDiceCount(level);
      const seed = Date.now();
      const dice = new SeededDiceRoller(seed);
      const rolled = dice.rollDie(8, diceCount, 0).total;
      const amount = rolled + wisMod;

      // For damage mode: CON save DC = 8 + prof + WIS mod.
      const saveDC = mode === "damage" ? 8 + proficiencyBonusByLevel(level) + wisMod : undefined;

      // Spend Channel Divinity and mark action spent
      const spentPool = spendResourceFromPool(resources, "channelDivinity:cleric", 1) as Record<string, unknown>;
      const updatedResources = { ...spentPool, actionSpent: true };

      const summary = mode === "heal"
        ? `Channels divinity to Divine Spark: restores ${amount} HP to the target (${diceCount}d8 + ${wisMod}).`
        : `Channels divinity to Divine Spark: ${damageType} damage — target makes DC ${saveDC} Constitution save or takes ${amount} (half on save).`;

      return {
        success: true,
        summary,
        data: {
          abilityName: "Divine Spark",
          updatedResources,
          mode,
          damageType,
          amount,
          diceCount,
          wisdomMod: wisMod,
          saveDC,
          saveAbility: "constitution",
          actorLevel: level,
          spendResource: { poolName: "channelDivinity:cleric", amount: 1 },
        },
      };
    } catch (err: any) {
      return { success: false, summary: err.message ?? "Failed to use Divine Spark", error: "EXECUTION_ERROR" };
    }
  }
}
