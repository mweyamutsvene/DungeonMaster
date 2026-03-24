/**
 * Rage Executor
 *
 * Handles the Barbarian's "Rage" class feature (level 1+).
 * As a bonus action, enter a Rage that grants:
 *   - Resistance to Bludgeoning, Piercing, Slashing damage
 *   - Rage Damage bonus on melee weapon attacks using Strength (+2/+3/+4)
 *   - Advantage on Strength checks and Strength saving throws
 * Lasts 10 rounds (1 minute). Uses per long rest: 2–6 based on level.
 *
 * D&D 5e 2024 rules.
 *
 * Uses ActiveEffect system: creates damage bonus + resistance + STR advantage effects.
 */

import type {
  AbilityExecutor,
  AbilityExecutionContext,
  AbilityExecutionResult,
} from "../../../../../../domain/abilities/ability-executor.js";
import { RAGE } from "../../../../../../domain/entities/classes/feature-keys.js";
import { rageDamageBonusForLevel } from "../../../../../../domain/entities/classes/barbarian.js";
import { createEffect } from "../../../../../../domain/entities/combat/effects.js";
import {
  hasResourceAvailable,
  spendResourceFromPool,
  hasBonusActionAvailable,
  getActiveEffects,
  addActiveEffectsToResources,
} from "../../../helpers/resource-utils.js";
import { nanoid } from "nanoid";
import { requireSheet, requireResources, requireClassFeature, extractClassInfo } from "../executor-helpers.js";

export class RageExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return normalized === "classbarbarianrage" || normalized === "rage";
  }

  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const { params } = context;

    const sheetErr = requireSheet(params); if (sheetErr) return sheetErr;
    const featureErr = requireClassFeature(params, RAGE, "Rage (requires Barbarian class)"); if (featureErr) return featureErr;
    const resourcesErr = requireResources(params); if (resourcesErr) return resourcesErr;

    const sheet = params!.sheet;
    const resources = params!.resources;
    const { level } = extractClassInfo(params);

    try {
      // Check if already raging via ActiveEffect
      const existingEffects = getActiveEffects(resources as any);
      const alreadyRaging = existingEffects.some(e => e.source === "Rage");
      if (alreadyRaging) {
        return {
          success: false,
          summary: "Already raging!",
          error: "ALREADY_ACTIVE",
        };
      }

      // Check bonus action availability
      if (!hasBonusActionAvailable(resources)) {
        return {
          success: false,
          summary: "No bonus action available (Rage requires a bonus action)",
          error: "NO_BONUS_ACTION",
        };
      }

      // Check rage uses remaining
      if (!hasResourceAvailable(resources, "rage", 1)) {
        return {
          success: false,
          summary: "No Rage uses remaining (recharges on long rest)",
          error: "INSUFFICIENT_USES",
        };
      }

      // Spend rage use
      let updatedResources = spendResourceFromPool(resources, "rage", 1);

      const bonus = rageDamageBonusForLevel(level);

      // Create ActiveEffects for Rage (all last until removed — 10 rounds / 1 minute)
      const rageEffects = [
        // Melee damage bonus (+2/+3/+4)
        createEffect(nanoid(), "bonus", "melee_damage_rolls", "permanent", {
          value: bonus,
          source: "Rage",
          description: `+${bonus} rage damage bonus on melee attacks`,
        }),
        // Resistance to B/P/S
        createEffect(nanoid(), "resistance", "custom", "permanent", {
          damageType: "bludgeoning",
          source: "Rage",
          description: "Resistance to bludgeoning damage",
        }),
        createEffect(nanoid(), "resistance", "custom", "permanent", {
          damageType: "piercing",
          source: "Rage",
          description: "Resistance to piercing damage",
        }),
        createEffect(nanoid(), "resistance", "custom", "permanent", {
          damageType: "slashing",
          source: "Rage",
          description: "Resistance to slashing damage",
        }),
        // Advantage on STR saves
        createEffect(nanoid(), "advantage", "saving_throws", "permanent", {
          ability: "strength",
          source: "Rage",
          description: "Advantage on Strength saving throws",
        }),
      ];

      updatedResources = addActiveEffectsToResources(updatedResources, ...rageEffects);

      // Keep raging flag for AI context builder presentation
      updatedResources = {
        ...(updatedResources as Record<string, unknown>),
        raging: true,
      } as any;

      return {
        success: true,
        summary: `Enters a Rage! Gains resistance to bludgeoning, piercing, and slashing damage, and +${bonus} bonus to melee weapon damage.`,
        data: {
          abilityName: "Rage",
          updatedResources,
          spendResource: { poolName: "rage", amount: 1 },
        },
        resourcesSpent: { rage: 1 },
      };
    } catch (err: any) {
      return {
        success: false,
        summary: err.message ?? "Failed to activate Rage",
        error: "EXECUTION_ERROR",
      };
    }
  }
}
