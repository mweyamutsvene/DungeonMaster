/**
 * Shared combatant-by-entity-ID lookup utilities.
 *
 * Replaces the duplicated pattern:
 *   combatants.find(c => c.characterId === id || c.monsterId === id || c.npcId === id)
 * across the codebase.
 */

import type { CombatantStateRecord } from "../../../types.js";

type EntityIdFields = Pick<CombatantStateRecord, "characterId" | "monsterId" | "npcId">;

/**
 * Find a combatant by their backing entity ID (characterId, monsterId, or npcId).
 *
 * Generic so the return type matches the array element type.
 */
export function findCombatantByEntityId<T extends EntityIdFields>(
  combatants: readonly T[],
  entityId: string,
): T | undefined {
  return combatants.find(
    (c) => c.characterId === entityId || c.monsterId === entityId || c.npcId === entityId,
  );
}

/**
 * Get the entity ID (characterId, monsterId, or npcId) from a combatant record.
 * Returns `null` if none is set.
 */
export function getEntityId(combatant: EntityIdFields): string | null {
  return combatant.characterId ?? combatant.monsterId ?? combatant.npcId;
}
