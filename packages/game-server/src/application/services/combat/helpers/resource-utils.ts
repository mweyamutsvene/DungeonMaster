import type { JsonValue } from "../../../types.js";
import type { ActiveEffect } from "../../../../domain/entities/combat/effects.js";
import { calculateFlatBonusFromEffects, hasConditionImmunity } from "../../../../domain/entities/combat/effects.js";
import { isRecord, readBoolean } from "./json-helpers.js";

export { readBoolean };

/**
 * Action economy resource utilities for managing combatant action state.
 *
 * These helpers normalize the `resources` field on combatant state records,
 * which is stored as JsonValue to support flexible resource tracking.
 */

/**
 * Normalize resources field to a plain object, handling null/undefined/non-object cases.
 */
export function normalizeResources(raw: unknown): Record<string, unknown> {
  return isRecord(raw) ? { ...raw } : {};
}

/**
 * Check if a combatant has already spent their action this turn.
 * For attack actions, considers Extra Attack feature.
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
 * Get the number of attacks used this turn.
 */
export function getAttacksUsedThisTurn(resources: JsonValue): number {
  const normalized = normalizeResources(resources);
  const val = normalized.attacksUsedThisTurn;
  return typeof val === "number" && Number.isInteger(val) && val >= 0 ? val : 0;
}

/**
 * Get the number of attacks allowed this turn (from Extra Attack, Action Surge, etc.).
 * Defaults to 1 if not set.
 */
export function getAttacksAllowedThisTurn(resources: JsonValue): number {
  const normalized = normalizeResources(resources);
  const val = normalized.attacksAllowedThisTurn;
  return typeof val === "number" && Number.isInteger(val) && val >= 1 ? val : 1;
}

/**
 * Check if a combatant can make another attack this turn.
 * Returns true if attacks used < attacks allowed and action not fully spent.
 */
export function canMakeAttack(resources: JsonValue): boolean {
  const normalized = normalizeResources(resources);
  const actionSpent = readBoolean(normalized, "actionSpent") ?? false;
  if (actionSpent) return false;
  
  const used = getAttacksUsedThisTurn(resources);
  const allowed = getAttacksAllowedThisTurn(resources);
  return used < allowed;
}

/**
 * Record an attack being used. Returns updated resources.
 * If all attacks are used, marks action as spent.
 */
export function useAttack(resources: JsonValue): JsonValue {
  const normalized = normalizeResources(resources);
  const used = getAttacksUsedThisTurn(resources);
  const allowed = getAttacksAllowedThisTurn(resources);
  const newUsed = used + 1;
  
  const updated: Record<string, unknown> = { ...normalized, attacksUsedThisTurn: newUsed };
  
  // Mark action spent when all attacks are used
  if (newUsed >= allowed) {
    updated.actionSpent = true;
  }
  
  return updated as JsonValue;
}

/**
 * Set the number of attacks allowed this turn (based on Extra Attack, Action Surge, etc.).
 */
export function setAttacksAllowed(resources: JsonValue, attacks: number): JsonValue {
  const normalized = normalizeResources(resources);
  return { ...normalized, attacksAllowedThisTurn: attacks } as JsonValue;
}

/**
 * Grant additional attacks (e.g., from Action Surge granting another Attack action).
 * Also resets actionSpent since a new action is granted.
 */
export function grantAdditionalAction(resources: JsonValue, extraAttacks: number): JsonValue {
  const normalized = normalizeResources(resources);
  const currentAllowed = getAttacksAllowedThisTurn(resources);
  return { 
    ...normalized, 
    attacksAllowedThisTurn: currentAllowed + extraAttacks,
    actionSpent: false,
  } as JsonValue;
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
    attacksUsedThisTurn: 0,
    sneakAttackUsedThisTurn: false,
    stunningStrikeUsedThisTurn: false,
    rageAttackedThisTurn: false,
    rageDamageTakenThisTurn: false,
    lastMovePath: undefined,
    // Weapon mastery turn-scoped tracking
    cleaveUsedThisTurn: false,
    nickUsedThisTurn: false,
    // Note: Vex mastery uses ActiveEffect with until_triggered duration (consumed on use)
    // Loading property: only one shot from Loading weapon per turn
    loadingWeaponFiredThisTurn: false,
    // Ready action: clear readied action at start of next turn (D&D 5e 2024)
    readiedAction: undefined,
    // Bonus action spell restriction (D&D 5e 2024): reset each turn
    bonusActionSpellCastThisTurn: false,
    actionSpellCastThisTurn: false,
    // Note: attacksAllowedThisTurn should be set separately based on character features
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

// ── ActiveEffect storage helpers ──────────────────────────────────────────────

/**
 * Read active effects from a combatant's resources bag.
 * Returns an empty array if the field is absent or malformed.
 */
export function getActiveEffects(resources: JsonValue): ActiveEffect[] {
  const normalized = normalizeResources(resources);
  const raw = normalized.activeEffects;
  if (!Array.isArray(raw)) return [];
  // Minimal shape check — trust the data was written by our helpers
  return raw.filter(
    (e): e is ActiveEffect => isRecord(e) && typeof (e as Record<string, unknown>).id === "string"
  );
}

/**
 * Replace the entire active effects array in a resources bag.
 */
export function setActiveEffects(resources: JsonValue, effects: readonly ActiveEffect[]): JsonValue {
  const normalized = normalizeResources(resources);
  return { ...normalized, activeEffects: effects as unknown as JsonValue } as JsonValue;
}

/**
 * Append one or more effects to a combatant's resources bag.
 */
export function addActiveEffectsToResources(resources: JsonValue, ...newEffects: ActiveEffect[]): JsonValue {
  const current = getActiveEffects(resources);
  return setActiveEffects(resources, [...current, ...newEffects]);
}

/**
 * Remove all effects that match a specific `source` string (e.g., when concentration breaks on "Bless").
 */
export function removeActiveEffectsBySource(resources: JsonValue, source: string): JsonValue {
  const effects = getActiveEffects(resources);
  const filtered = effects.filter(e => e.source !== source);
  return setActiveEffects(resources, filtered);
}

/**
 * Remove all concentration effects applied by a specific caster.
 */
export function removeConcentrationEffectsFromResources(
  resources: JsonValue,
  sourceCombatantId: string
): JsonValue {
  const effects = getActiveEffects(resources);
  const filtered = effects.filter(
    e => !(e.duration === "concentration" && e.sourceCombatantId === sourceCombatantId)
  );
  return setActiveEffects(resources, filtered);
}

/**
 * Remove a single effect by its ID.
 */
export function removeActiveEffectById(resources: JsonValue, effectId: string): JsonValue {
  const effects = getActiveEffects(resources);
  return setActiveEffects(resources, effects.filter(e => e.id !== effectId));
}

/**
 * Get the effective speed for a combatant, incorporating ActiveEffect modifiers.
 * Base speed comes from `resources.speed` (default 30).
 * Speed modifiers from effects are added (clamped to minimum 0).
 */
export function getEffectiveSpeed(resources: JsonValue): number {
  const normalized = normalizeResources(resources);
  const baseSpeed = typeof normalized.speed === "number" ? normalized.speed : 30;
  const effects = getActiveEffects(resources);
  // Combine speed_modifier type effects + bonus/penalty on speed target
  let modifier = 0;
  for (const e of effects) {
    if (e.type === 'speed_modifier' || (e.target === 'speed' && (e.type === 'bonus' || e.type === 'penalty'))) {
      const val = e.value ?? 0;
      modifier += e.type === 'penalty' ? -val : val;
    }
  }
  return Math.max(0, baseSpeed + modifier);
}

/**
 * Check if a combatant is immune to a condition due to ActiveEffects.
 * Returns true if the condition should be blocked.
 */
export function isConditionImmuneByEffects(resources: JsonValue, conditionName: string): boolean {
  const effects = getActiveEffects(resources);
  return hasConditionImmunity(effects, conditionName);
}

// ── Drawn weapon tracking ─────────────────────────────────────────────────────

/**
 * Get the list of currently drawn (in-hand) weapon names.
 * Returns undefined if drawnWeapons has never been initialized (legacy combatants).
 * An empty array means the combatant has no weapons drawn.
 */
export function getDrawnWeapons(resources: JsonValue): string[] | undefined {
  const normalized = normalizeResources(resources);
  const drawn = normalized.drawnWeapons;
  if (!Array.isArray(drawn)) return undefined;
  return drawn.filter((n): n is string => typeof n === "string");
}

/**
 * Check if a specific weapon is currently drawn.
 * If drawnWeapons is not initialized (legacy), returns true (all weapons available).
 */
export function isWeaponDrawn(resources: JsonValue, weaponName: string): boolean {
  const drawn = getDrawnWeapons(resources);
  if (drawn === undefined) return true; // Legacy: all weapons available
  return drawn.some(n => n.toLowerCase() === weaponName.toLowerCase());
}

/**
 * Add a weapon to the drawn list.
 * If drawnWeapons is not yet initialized, creates the array.
 */
export function addDrawnWeapon(resources: JsonValue, weaponName: string): JsonValue {
  const normalized = normalizeResources(resources);
  const drawn = getDrawnWeapons(resources) ?? [];
  if (!drawn.some(n => n.toLowerCase() === weaponName.toLowerCase())) {
    drawn.push(weaponName);
  }
  return { ...normalized, drawnWeapons: drawn } as JsonValue;
}

/**
 * Remove a weapon from the drawn list.
 * No-op if the weapon is not drawn or drawnWeapons is not initialized.
 */
export function removeDrawnWeapon(resources: JsonValue, weaponName: string): JsonValue {
  const normalized = normalizeResources(resources);
  const drawn = getDrawnWeapons(resources);
  if (!drawn) return resources; // Legacy: no-op
  const updated = drawn.filter(n => n.toLowerCase() !== weaponName.toLowerCase());
  return { ...normalized, drawnWeapons: updated } as JsonValue;
}

// ── Inventory tracking (CharacterItemInstance[] in resources) ──────────────────

import type { CharacterItemInstance } from "../../../../domain/entities/items/magic-item.js";

/**
 * Get the inventory array from combatant resources.
 * Returns empty array if not initialized.
 */
export function getInventory(resources: JsonValue): CharacterItemInstance[] {
  const normalized = normalizeResources(resources);
  const inv = normalized.inventory;
  if (!Array.isArray(inv)) return [];
  return inv as CharacterItemInstance[];
}

/**
 * Set the inventory array on combatant resources.
 */
export function setInventory(resources: JsonValue, inventory: CharacterItemInstance[]): JsonValue {
  const normalized = normalizeResources(resources);
  return { ...normalized, inventory } as JsonValue;
}
