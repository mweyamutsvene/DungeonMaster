import type { JsonValue } from "../../../types.js";

/**
 * Action economy resource utilities for managing combatant action state.
 *
 * These helpers normalize the `resources` field on combatant state records,
 * which is stored as JsonValue to support flexible resource tracking.
 */

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null;
}

/**
 * Normalize resources field to a plain object, handling null/undefined/non-object cases.
 */
export function normalizeResources(raw: unknown): Record<string, unknown> {
  return isRecord(raw) ? { ...raw } : {};
}

/**
 * Read a boolean value from a resources object, returning null if not present or wrong type.
 */
export function readBoolean(obj: Record<string, unknown>, key: string): boolean | null {
  const v = obj[key];
  return typeof v === "boolean" ? v : null;
}

/**
 * Check if a combatant has already spent their action this turn.
 */
export function hasSpentAction(resources: JsonValue): boolean {
  const normalized = normalizeResources(resources);
  return readBoolean(normalized, "actionSpent") ?? false;
}

/**
 * Mark a combatant's action as spent by updating their resources.
 */
export function spendAction(resources: JsonValue): JsonValue {
  const normalized = normalizeResources(resources);
  return { ...normalized, actionSpent: true } as JsonValue;
}

/**
 * Clear the actionSpent flag (used when advancing turns or rounds).
 */
export function clearActionSpent(resources: JsonValue): JsonValue {
  if (!isRecord(resources)) return { actionSpent: false };
  if (resources.actionSpent === false || resources.actionSpent === undefined) return resources;
  return { ...resources, actionSpent: false };
}

/**
 * Check if a combatant has their reaction available.
 */
export function hasReactionAvailable(resources: JsonValue): boolean {
  const normalized = normalizeResources(resources);
  return readBoolean(normalized, "reactionUsed") !== true;
}

/**
 * Mark a combatant's reaction as used.
 */
export function useReaction(resources: JsonValue): JsonValue {
  const normalized = normalizeResources(resources);
  return { ...normalized, reactionUsed: true } as JsonValue;
}

/**
 * Reset reaction (at start of turn).
 */
export function resetReaction(resources: JsonValue): JsonValue {
  const normalized = normalizeResources(resources);
  return { ...normalized, reactionUsed: false } as JsonValue;
}

/**
 * Check if a combatant took the Disengage action this turn.
 */
export function hasDisengaged(resources: JsonValue): boolean {
  const normalized = normalizeResources(resources);
  return readBoolean(normalized, "disengaged") === true;
}

/**
 * Mark that a combatant took the Disengage action.
 */
export function markDisengaged(resources: JsonValue): JsonValue {
  const normalized = normalizeResources(resources);
  return { ...normalized, disengaged: true } as JsonValue;
}

/**
 * Clear disengage flag (at start of turn).
 */
export function clearDisengage(resources: JsonValue): JsonValue {
  const normalized = normalizeResources(resources);
  if (!normalized.disengaged) return resources;
  return { ...normalized, disengaged: false } as JsonValue;
}

/**
 * Reset turn-based resources (action, reaction, disengage) at start of combatant's turn.
 */
export function resetTurnResources(resources: JsonValue): JsonValue {
  const normalized = normalizeResources(resources);
  return {
    ...normalized,
    actionSpent: false,
    reactionUsed: false,
    disengaged: false,
    bonusActionUsed: false,
    dashed: false,
    movementSpent: false,
  } as JsonValue;
}

/**
 * Check if a combatant has their bonus action available.
 */
export function hasBonusActionAvailable(resources: JsonValue): boolean {
  const normalized = normalizeResources(resources);
  return readBoolean(normalized, "bonusActionUsed") !== true;
}

/**
 * Mark a combatant's bonus action as used.
 */
export function useBonusAction(resources: JsonValue): JsonValue {
  const normalized = normalizeResources(resources);
  return { ...normalized, bonusActionUsed: true } as JsonValue;
}

/**
 * Read a number value from a resources object, returning null if not present or wrong type.
 */
export function readNumber(obj: Record<string, unknown>, key: string): number | null {
  const v = obj[key];
  return typeof v === "number" ? v : null;
}

/**
 * Get position from resources (x, y coordinates in feet).
 */
export function getPosition(resources: JsonValue): { x: number; y: number } | null {
  const normalized = normalizeResources(resources);
  const position = normalized.position;
  
  if (!isRecord(position)) return null;
  
  const x = readNumber(position as Record<string, unknown>, "x");
  const y = readNumber(position as Record<string, unknown>, "y");
  
  if (x === null || y === null) return null;
  
  return { x, y };
}

/**
 * Set position in resources.
 */
export function setPosition(resources: JsonValue, position: { x: number; y: number }): JsonValue {
  const normalized = normalizeResources(resources);
  return { ...normalized, position } as JsonValue;
}

/**
 * Check if combatant has a position set.
 */
export function hasPosition(resources: JsonValue): boolean {
  return getPosition(resources) !== null;
}

/**
 * Get resource pools from resources (e.g., ki, rage, spell slots).
 */
export function getResourcePools(resources: JsonValue): Array<{ name: string; current: number; max: number }> {
  const normalized = normalizeResources(resources);
  const pools = normalized.resourcePools;
  
  if (!Array.isArray(pools)) return [];
  
  return pools.filter((p): p is { name: string; current: number; max: number } => {
    return (
      isRecord(p) &&
      typeof p.name === 'string' &&
      typeof p.current === 'number' &&
      typeof p.max === 'number'
    );
  });
}

/**
 * Update a specific resource pool by name.
 */
export function updateResourcePool(
  resources: JsonValue,
  poolName: string,
  updater: (pool: { name: string; current: number; max: number }) => { name: string; current: number; max: number }
): JsonValue {
  const normalized = normalizeResources(resources);
  const pools = getResourcePools(resources);
  
  const updatedPools = pools.map(pool => 
    pool.name === poolName ? updater(pool) : pool
  );
  
  return { ...normalized, resourcePools: updatedPools } as JsonValue;
}

/**
 * Check if a resource pool has at least the specified amount available.
 */
export function hasResourceAvailable(resources: JsonValue, poolName: string, amount: number): boolean {
  const pools = getResourcePools(resources);
  const pool = pools.find(p => p.name === poolName);
  return pool ? pool.current >= amount : false;
}

/**
 * Spend from a resource pool, returning updated resources.
 * Throws if insufficient resources.
 */
export function spendResourceFromPool(
  resources: JsonValue,
  poolName: string,
  amount: number
): JsonValue {
  if (!hasResourceAvailable(resources, poolName, amount)) {
    const pools = getResourcePools(resources);
    const pool = pools.find(p => p.name === poolName);
    const current = pool?.current ?? 0;
    throw new Error(`Insufficient ${poolName}: has ${current}, needs ${amount}`);
  }
  
  return updateResourcePool(resources, poolName, (pool) => ({
    ...pool,
    current: pool.current - amount,
  }));
}
