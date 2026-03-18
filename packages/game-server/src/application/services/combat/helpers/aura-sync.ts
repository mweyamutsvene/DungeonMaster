/**
 * Aura Sync — Updates aura zone centers when their attached combatant moves.
 *
 * Call this after any movement that changes a combatant's position on the map.
 * Aura zones (Spirit Guardians, Paladin Aura) have `type: 'aura'` and `attachedTo`
 * set to a combatant ID. When that combatant moves, the zone center must follow.
 */

import type { Position } from "../../../../domain/rules/movement.js";
import type { CombatMap } from "../../../../domain/rules/combat-map.js";
import { getMapZones, setMapZones } from "../../../../domain/rules/combat-map.js";
import { syncAuraZoneCenter } from "../../../../domain/entities/combat/zones.js";
import type { JsonValue } from "../../../types.js";

/**
 * Minimal combat repo interface for aura sync.
 */
export interface AuraSyncCombatRepo {
  getEncounterById(id: string): Promise<{ id: string; mapData?: JsonValue } | null>;
  updateEncounter(id: string, patch: { mapData?: JsonValue }): Promise<unknown>;
}

/**
 * Sync all aura zones attached to a combatant to their new position.
 *
 * @param combatRepo - Repository for loading/saving encounter map data
 * @param encounterId - The encounter containing the zones
 * @param combatantId - The combatant that moved (entity ID, not combatant record ID)
 * @param newPosition - The combatant's new position after movement
 * @returns true if any zones were updated
 */
export async function syncAuraZones(
  combatRepo: AuraSyncCombatRepo,
  encounterId: string,
  combatantId: string,
  newPosition: Position,
): Promise<boolean> {
  const encounter = await combatRepo.getEncounterById(encounterId);
  if (!encounter?.mapData) return false;

  const map = encounter.mapData as unknown as CombatMap;
  const zones = getMapZones(map);
  if (zones.length === 0) return false;

  let anyUpdated = false;
  const updatedZones = zones.map(zone => {
    if (zone.type === "aura" && zone.attachedTo === combatantId) {
      anyUpdated = true;
      return syncAuraZoneCenter(zone, newPosition);
    }
    return zone;
  });

  if (anyUpdated) {
    const updatedMap = setMapZones(map, updatedZones);
    await combatRepo.updateEncounter(encounterId, {
      mapData: updatedMap as unknown as JsonValue,
    });
  }

  return anyUpdated;
}
