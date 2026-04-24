/**
 * Magical Cunning Executor (Warlock L2, 2024 PHB).
 *
 * RAW 2024:
 *  - 1-minute ritual action (out-of-combat in most cases; treat as a full-round
 *    action in combat with narrative justification)
 *  - Spend 1 Magical Cunning use (1 per long rest)
 *  - Recover spent Pact Magic slots equal to half your maximum (rounded up)
 *
 * Implementation: spends 1 `magicalCunning` resource, then increments `pactMagic`
 * pool by ceil(max/2), capped at max. Uses the same pool keys already in use.
 */

import type {
  AbilityExecutor,
  AbilityExecutionContext,
  AbilityExecutionResult,
} from "../../../../../../domain/abilities/ability-executor.js";
import { MAGICAL_CUNNING } from "../../../../../../domain/entities/classes/feature-keys.js";
import { requireResources, requireClassFeature } from "../executor-helpers.js";
import { hasResourceAvailable, spendResourceFromPool, normalizeResources, patchResources } from "../../../helpers/resource-utils.js";
import type { JsonValue } from "../../../../../types.js";

export class MagicalCunningExecutor implements AbilityExecutor {
  canExecute(abilityId: string): boolean {
    const normalized = abilityId.toLowerCase().replace(/[^a-z0-9]+/g, "");
    return normalized === "classwarlockmagicalcunning" || normalized === "magicalcunning";
  }

  async execute(context: AbilityExecutionContext): Promise<AbilityExecutionResult> {
    const { params } = context;

    const featureErr = requireClassFeature(params, MAGICAL_CUNNING, "Magical Cunning (requires Warlock level 2+)"); if (featureErr) return featureErr;
    const resourcesErr = requireResources(params); if (resourcesErr) return resourcesErr;

    const resources = params!.resources;

    try {
      if (!hasResourceAvailable(resources, "magicalCunning", 1)) {
        return {
          success: false,
          summary: "No Magical Cunning uses remaining (recharges on long rest)",
          error: "INSUFFICIENT_USES",
        };
      }

      const normalized = normalizeResources(resources);
      const pools = Array.isArray((normalized as any).resourcePools) ? (normalized as any).resourcePools : [];
      const pactPool = pools.find((p: any) => p.name === "pactMagic");
      if (!pactPool) {
        return {
          success: false,
          summary: "No Pact Magic pool found — Magical Cunning has nothing to restore",
          error: "NO_PACT_POOL",
        };
      }

      const pactMax = typeof pactPool.max === "number" ? pactPool.max : 0;
      const pactCurrent = typeof pactPool.current === "number" ? pactPool.current : 0;
      const toRestore = Math.ceil(pactMax / 2);
      const newCurrent = Math.min(pactMax, pactCurrent + toRestore);
      const actualRestored = newCurrent - pactCurrent;

      // Spend the Magical Cunning use, then patch pactMagic current.
      const afterSpend = spendResourceFromPool(resources, "magicalCunning", 1) as Record<string, unknown>;
      const afterSpendPools = Array.isArray((afterSpend as any).resourcePools) ? (afterSpend as any).resourcePools : [];
      const updatedPools = afterSpendPools.map((p: any) =>
        p.name === "pactMagic" ? { ...p, current: newCurrent } : p,
      );
      const updatedResources = patchResources(afterSpend, { resourcePools: updatedPools });

      return {
        success: true,
        summary: `Magical Cunning: performs a 1-minute ritual and recovers ${actualRestored} Pact Magic slot(s) (${pactCurrent} → ${newCurrent}/${pactMax}).`,
        resourcesSpent: { magicalCunning: 1 },
        data: {
          abilityName: "Magical Cunning",
          pactSlotsRestored: actualRestored,
          pactCurrent: newCurrent,
          pactMax,
          spendResource: { poolName: "magicalCunning", amount: 1 },
          updatedResources,
        },
      };
    } catch (err: any) {
      return {
        success: false,
        summary: err.message ?? "Failed to use Magical Cunning",
        error: "EXECUTION_ERROR",
      };
    }
  }
}
