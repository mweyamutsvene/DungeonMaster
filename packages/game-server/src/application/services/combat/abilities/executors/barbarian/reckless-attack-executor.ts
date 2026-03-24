/**
 * Reckless Attack Executor
 *
 * Handles the Barbarian's "Reckless Attack" feature (level 2+).
 * Free action (no action economy cost). When activated:
 *   - Grants advantage on melee weapon attacks using Strength for this turn
 *   - Attack rolls against you have advantage until the start of your next turn
 *
 * D&D 5e 2024 rules.
 *
 * Uses ActiveEffect system: creates two effects instead of a resource flag.
 */

import type {
  AbilityExecutor,
  AbilityExecutionContext,
  AbilityExecutionResult,
} from "../../../../../../domain/abilities/ability-executor.js";
import { RECKLESS_ATTACK } from "../../../../../../domain/entities/classes/feature-keys.js";
import { createEffect } from "../../../../../../domain/entities/combat/effects.js";
import { addActiveEffectsToResources, getActiveEffects } from "../../../helpers/resource-utils.js";
import { nanoid } from "nanoid";
import { requireSheet, requireResources, requireClassFeature } from "../executor-helpers.js";

export class RecklessAttackExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return (
      normalized === "classbarbarianrecklessattack" || normalized === "recklessattack"
    );
  }

  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const { params } = context;

    const sheetErr = requireSheet(params); if (sheetErr) return sheetErr;
    const featureErr = requireClassFeature(params, RECKLESS_ATTACK, "Reckless Attack (requires Barbarian level 2+)"); if (featureErr) return featureErr;
    const resourcesErr = requireResources(params); if (resourcesErr) return resourcesErr;

    const sheet = params!.sheet;
    const resources = params!.resources;

    try {
      // Check if already active via ActiveEffect
      const existingEffects = getActiveEffects(resources as any);
      const alreadyReckless = existingEffects.some(e => e.source === "Reckless Attack");
      if (alreadyReckless) {
        return {
          success: false,
          summary: "Reckless Attack is already active this turn",
          error: "ALREADY_ACTIVE",
        };
      }

      const actorId = context.actor.getId();

      // Effect 1: Advantage on melee attack rolls for this turn
      const selfAdvantage = createEffect(
        nanoid(),
        "advantage",
        "melee_attack_rolls",
        "until_end_of_turn",
        {
          source: "Reckless Attack",
          description: "Advantage on melee Strength attack rolls this turn",
        },
      );

      // Effect 2: Attacks against you have advantage until start of your next turn
      // Stored as a target-anchored advantage effect on the barbarian's own resources
      const incomingAdvantage = createEffect(
        nanoid(),
        "advantage",
        "attack_rolls",
        "until_start_of_next_turn",
        {
          source: "Reckless Attack",
          targetCombatantId: actorId,
          description: "Attack rolls against this creature have advantage",
        },
      );

      const updatedResources = addActiveEffectsToResources(
        resources as any,
        selfAdvantage,
        incomingAdvantage,
      );

      return {
        success: true,
        summary: "Attacks recklessly! Gains advantage on melee Strength attacks this turn, but attack rolls against you have advantage until the start of your next turn.",
        data: {
          abilityName: "Reckless Attack",
          updatedResources,
        },
      };
    } catch (err: any) {
      return {
        success: false,
        summary: err.message ?? "Failed to activate Reckless Attack",
        error: "EXECUTION_ERROR",
      };
    }
  }
}
