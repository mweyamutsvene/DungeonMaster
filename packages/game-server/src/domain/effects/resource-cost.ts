import type { ResourcePool } from "../entities/combat/resource-pool.js";
import { spendResource } from "../entities/combat/resource-pool.js";

export interface ResourceCost {
  poolName: string;
  amount: number;
}

export function applyResourceCost(
  pools: readonly ResourcePool[],
  cost: ResourceCost,
): ResourcePool[] {
  if (!Number.isInteger(cost.amount) || cost.amount < 0) {
    throw new Error("Resource cost amount must be an integer >= 0");
  }

  const index = pools.findIndex((p) => p.name === cost.poolName);
  if (index === -1) {
    throw new Error(`Unknown resource pool: ${cost.poolName}`);
  }

  const updated = spendResource(pools[index]!, cost.amount);
  const next = pools.slice();
  next[index] = updated;
  return next;
}
