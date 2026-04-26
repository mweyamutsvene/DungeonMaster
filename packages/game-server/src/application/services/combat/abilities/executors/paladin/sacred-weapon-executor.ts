/**
 * Sacred Weapon Executor (Oath of Devotion Paladin L3+)
 *
 * Channel Divinity: Sacred Weapon. Bonus action.
 * For 1 minute: +CHA modifier to attack rolls + weapon counts as magical.
 * D&D 5e 2024 rules.
 */

import type { AbilityExecutor, AbilityExecutionContext, AbilityExecutionResult } from "../../../../../../domain/abilities/ability-executor.js";
import { SACRED_WEAPON } from "../../../../../../domain/entities/classes/feature-keys.js";
import { requireSheet, requireResources, requireClassFeature } from "../executor-helpers.js";
import { hasResourceAvailable, hasBonusActionAvailable } from "../../../helpers/resource-utils.js";
import type { ActiveEffect } from "../../../../../../domain/entities/combat/effects.js";

export class SacredWeaponExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return (
      normalized === "classpaladinsacredweapon" ||
      normalized === "sacredweapon" ||
      normalized === "channeldivinitysacredweapon"
    );
  }

  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const { params } = context;

    const sheetErr = requireSheet(params); if (sheetErr) return sheetErr;
    const featureErr = requireClassFeature(params, SACRED_WEAPON, "Sacred Weapon (requires Oath of Devotion Paladin level 3+)"); if (featureErr) return featureErr;
    const resourcesErr = requireResources(params); if (resourcesErr) return resourcesErr;

    const resources = params!.resources;
    const sheet = params!.sheet as Record<string, unknown>;

    // Must have bonus action available
    if (!hasBonusActionAvailable(resources)) {
      return { success: false, summary: "No bonus action available", error: "NO_BONUS_ACTION" };
    }

    // Must have Channel Divinity use
    if (!hasResourceAvailable(resources, "channelDivinity:paladin", 1)) {
      return { success: false, summary: "No Channel Divinity uses remaining", error: "INSUFFICIENT_USES" };
    }

    // Compute CHA modifier
    const abilityScores = (sheet.abilityScores as Record<string, number> | undefined) ?? {};
    const chaMod = Math.floor(((abilityScores.charisma ?? 10) - 10) / 2);

    // Apply as ActiveEffect: +chaMod to attack rolls for 10 rounds
    const attackEffect: ActiveEffect = {
      id: `sacred-weapon-${Date.now()}`,
      type: "bonus",
      source: "Sacred Weapon",
      target: "attack_rolls",
      value: chaMod,
      duration: "rounds",
      roundsRemaining: 10,
    };

    const sign = chaMod >= 0 ? "+" : "";
    return {
      success: true,
      summary: `Sacred Weapon: weapon imbued with holy power! ${sign}${chaMod} to attack rolls for 1 minute (CHA mod).`,
      data: {
        abilityName: "Sacred Weapon",
        effect: attackEffect,
        chaMod,
        spendResource: { poolName: "channelDivinity:paladin", amount: 1 },
      },
    };
  }
}
