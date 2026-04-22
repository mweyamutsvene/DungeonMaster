/**
 * Lay on Hands Executor
 *
 * Handles the Paladin's "Lay on Hands" class feature (level 1+).
 * As a bonus action, restore HP from a pool of 5 × Paladin level.
 * Heals the maximum amount possible (capped by missing HP and pool remaining).
 *
 * D&D 5e 2024 rules.
 */

import type {
  AbilityExecutor,
  AbilityExecutionContext,
  AbilityExecutionResult,
} from "../../../../../../domain/abilities/ability-executor.js";
import { LAY_ON_HANDS } from "../../../../../../domain/entities/classes/feature-keys.js";
import { requireSheet, requireResources, requireClassFeature } from "../executor-helpers.js";
import { hasResourceAvailable, hasBonusActionAvailable } from "../../../helpers/resource-utils.js";

export class LayOnHandsExecutor implements AbilityExecutor {
  readonly allowsAllyTarget = true;

  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return normalized === "classpaladinlayonhands" || normalized === "layonhands";
  }

  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const { actor, params, combat, target } = context;

    const sheetErr = requireSheet(params); if (sheetErr) return sheetErr;
    const featureErr = requireClassFeature(params, LAY_ON_HANDS, "Lay on Hands (requires Paladin class)"); if (featureErr) return featureErr;
    const resourcesErr = requireResources(params); if (resourcesErr) return resourcesErr;

    const resources = params!.resources;

    try {
      // Check bonus action availability
      if (!hasBonusActionAvailable(resources)) {
        return {
          success: false,
          summary: "No bonus action available (Lay on Hands requires a bonus action)",
          error: "NO_BONUS_ACTION",
        };
      }

      // Check pool has HP remaining
      if (!hasResourceAvailable(resources, "layOnHands", 1)) {
        return {
          success: false,
          summary: "No Lay on Hands HP remaining (recharges on long rest)",
          error: "INSUFFICIENT_USES",
        };
      }

      // Determine healing target: ally (via params.targetEntityId + context.target) or self
      const targetEntityId = params?.targetEntityId as string | undefined;
      const healTarget = (targetEntityId && target) ? target : actor;
      const isSelf = healTarget === actor;

      // Validate touch range (5 feet) when targeting an ally
      if (!isSelf) {
        const actorPos = combat.getPosition(actor.getId());
        const targetPos = combat.getPosition(healTarget.getId());
        if (actorPos && targetPos) {
          const dx = Math.abs(actorPos.x - targetPos.x);
          const dy = Math.abs(actorPos.y - targetPos.y);
          // D&D 5e touch range = 5 feet = 1 grid cell (Chebyshev distance)
          if (dx > 1 || dy > 1) {
            return {
              success: false,
              summary: "Target is out of touch range (must be within 5 feet)",
              error: "OUT_OF_RANGE",
            };
          }
        }
      }

      // Calculate healing: heal max possible, capped by missing HP and pool remaining
      const currentHP = healTarget.getCurrentHP();
      const maxHP = healTarget.getMaxHP();
      const missingHP = maxHP - currentHP;

      if (missingHP <= 0) {
        const who = isSelf ? "Already" : `${healTarget.getName()} is already`;
        return {
          success: false,
          summary: `${who} at full HP — no healing needed`,
          error: "FULL_HP",
        };
      }

      // Find pool remaining
      const res = resources as Record<string, unknown>;
      const pools = (res.resourcePools ?? []) as Array<{ name: string; current: number; max: number }>;
      const lohPool = pools.find((p) => p.name === "layOnHands");
      const poolRemaining = lohPool?.current ?? 0;

      if (poolRemaining <= 0) {
        return {
          success: false,
          summary: "No Lay on Hands HP remaining",
          error: "INSUFFICIENT_USES",
        };
      }

      // Parse player-specified amount from text (e.g. "lay on hands 10", "heal 15 hp")
      let requestedAmount: number | undefined;
      const text = (params?.text as string) ?? "";
      const amountMatch = text.match(/\b(\d+)\s*(?:hp|hit\s*points?)?\b/i);
      if (amountMatch) {
        const parsed = parseInt(amountMatch[1], 10);
        if (parsed > 0) requestedAmount = parsed;
      }

      // Heal the requested amount (if specified), capped by missing HP and pool remaining
      const maxHeal = Math.min(missingHP, poolRemaining);
      const healAmount = requestedAmount ? Math.min(requestedAmount, maxHeal) : maxHeal;
      const newHP = currentHP + healAmount;
      const targetLabel = isSelf ? "" : ` on ${healTarget.getName()}`;

      return {
        success: true,
        summary: `Lays on Hands${targetLabel}! Restores ${healAmount} HP. (${poolRemaining - healAmount} HP remaining in pool)`,
        data: {
          abilityName: "Lay on Hands",
          hpUpdate: { hpCurrent: newHP },
          spendResource: { poolName: "layOnHands", amount: healAmount },
          ...(isSelf ? {} : { targetEntityId: healTarget.getId() }),
        },
      };
    } catch (err: any) {
      return {
        success: false,
        summary: err.message ?? "Failed to use Lay on Hands",
        error: "EXECUTION_ERROR",
      };
    }
  }
}
