/**
 * Sync CombatMap entity positions when combatants move.
 *
 * The combat map's `entities[]` array tracks creature positions for
 * collision detection, size-based blocking, and line-of-sight computations.
 * This helper keeps it in sync with `resources.position` updates.
 */

import type { ICombatRepository } from "../../../repositories/combat-repository.js";
import type { CombatMap, MapEntity } from "../../../../domain/rules/combat-map.js";
import { moveEntity, addEntity, getEntity } from "../../../../domain/rules/combat-map.js";
import type { Position } from "../../../../domain/rules/movement.js";

export interface SyncEntityPositionOptions {
  /** Combatant's faction (e.g. "party", "enemies") for the MapEntity */
  faction?: string;
  /** Creature size for the MapEntity — defaults to "Medium" */
  size?: MapEntity["size"];
}

/**
 * Update (or create) a map entity's position to stay in sync with
 * `resources.position` on the combatant state.
 *
 * If the encounter has no map data this is a no-op.
 * If the entity doesn't exist yet in `entities[]`, it is created automatically.
 */
export async function syncEntityPosition(
  combatRepo: ICombatRepository,
  encounterId: string,
  combatantId: string,
  newPosition: Position,
  options?: SyncEntityPositionOptions,
): Promise<void> {
  const encounter = await combatRepo.getEncounterById(encounterId);
  if (!encounter?.mapData) return;

  let map = encounter.mapData as unknown as CombatMap;
  if (!map.entities) {
    // Safety: if mapData exists but entities array was never initialised
    map = { ...map, entities: [] };
  }

  const existing = getEntity(map, combatantId);
  let updatedMap: CombatMap;

  if (existing) {
    updatedMap = moveEntity(map, combatantId, newPosition);
  } else {
    const entity: MapEntity = {
      id: combatantId,
      type: "creature",
      position: newPosition,
      size: options?.size ?? "Medium",
      ...(options?.faction ? { faction: options.faction } : {}),
    };
    updatedMap = addEntity(map, entity);
  }

  await combatRepo.updateEncounter(encounterId, {
    mapData: updatedMap as any,
  });
}
