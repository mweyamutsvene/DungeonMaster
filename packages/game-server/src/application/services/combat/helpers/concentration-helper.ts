/**
 * Concentration lifecycle helpers.
 *
 * Shared by ActionService (programmatic) and RollStateMachine (tabletop)
 * to provide consistent concentration tracking, break logic, and cleanup.
 *
 * Canonical field: `resources.concentrationSpellName` (string | undefined).
 */

import type { ICombatRepository } from "../../../repositories/combat-repository.js";
import type { CombatantStateRecord, JsonValue } from "../../../types.js";
import {
  normalizeResources,
  getActiveEffects,
  setActiveEffects,
} from "./resource-utils.js";
import { removeConcentrationZones } from "../../../../domain/entities/combat/zones.js";
import { getMapZones, setMapZones } from "../../../../domain/rules/combat-map.js";
import type { CombatMap } from "../../../../domain/rules/combat-map.js";

// ───────────────────────── Reading / Writing ─────────────────────────

/**
 * Read the concentration spell name from a combatant's resources bag.
 * Returns `undefined` if the combatant is not concentrating.
 */
export function getConcentrationSpellName(
  resources: JsonValue | null | undefined,
): string | undefined {
  const r = normalizeResources(resources);
  const v = r.concentrationSpellName;
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

// ───────────────────── Breaking Concentration ────────────────────────

export interface ConcentrationBreakResult {
  spellName: string;
  casterId: string;
}

/**
 * Break concentration for a combatant.
 *
 * 1. Removes `concentrationSpellName` from the combatant's resources
 * 2. Strips all `duration: 'concentration'` ActiveEffects sourced by this caster
 *    from every combatant in the encounter
 * 3. Removes concentration zones owned by this caster from the map
 *
 * Returns `null` if the combatant was not concentrating.
 */
export async function breakConcentration(
  combatant: CombatantStateRecord,
  encounterId: string,
  combatRepo: ICombatRepository,
  debugLog?: (msg: string) => void,
): Promise<ConcentrationBreakResult | null> {
  const resources = normalizeResources(combatant.resources);
  const spellName = getConcentrationSpellName(combatant.resources);
  if (!spellName) return null;

  const casterId =
    combatant.characterId ?? combatant.monsterId ?? combatant.npcId ?? combatant.id;

  // 1. Remove tracking field + discard readied spell if held via concentration
  delete resources.concentrationSpellName;
  // D&D 5e 2024: If you Ready a spell, it uses concentration. If concentration
  // breaks before the trigger, the spell is wasted and the readied action is lost.
  const readiedAction = resources.readiedAction as {
    responseType?: string;
    spellName?: string;
  } | undefined;
  if (readiedAction?.spellName) {
    delete resources.readiedAction;
    debugLog?.(`Readied spell "${readiedAction.spellName}" lost — concentration broken`);
  }
  await combatRepo.updateCombatantState(combatant.id, {
    resources: resources as JsonValue,
  });
  debugLog?.(`Concentration on "${spellName}" broken!`);

  // 2. Remove concentration effects from ALL combatants in the encounter
  const allCombatants = await combatRepo.listCombatants(encounterId);
  for (const c of allCombatants) {
    const effects = getActiveEffects(c.resources ?? {});
    const filtered = effects.filter(
      (e) =>
        !(
          e.duration === "concentration" &&
          (e.sourceCombatantId === casterId || e.source === spellName)
        ),
    );
    if (filtered.length !== effects.length) {
      const updatedRes = setActiveEffects(c.resources ?? {}, filtered);
      await combatRepo.updateCombatantState(c.id, {
        resources: updatedRes as JsonValue,
      });
      debugLog?.(
        `Removed ${effects.length - filtered.length} concentration effects from ${c.id}`,
      );
    }
  }

  // 3. Remove concentration zones from the map
  const freshEnc = await combatRepo.getEncounterById(encounterId);
  if (freshEnc?.mapData) {
    const zoneMap = freshEnc.mapData as unknown as CombatMap;
    const zones = getMapZones(zoneMap);
    const remaining = removeConcentrationZones(zones, casterId);
    if (remaining.length !== zones.length) {
      const updatedMap = setMapZones(zoneMap, remaining);
      await combatRepo.updateEncounter(encounterId, {
        mapData: updatedMap as unknown as Record<string, unknown>,
      });
      debugLog?.(
        `Removed ${zones.length - remaining.length} concentration zone(s) for ${casterId}`,
      );
    }
  }

  return { spellName, casterId };
}

// ───────────── CON Save Modifier ──────────────

/**
 * Compute the Constitution saving throw modifier for a creature.
 * Includes ability modifier + proficiency bonus if proficient in CON saves.
 */
export function computeConSaveModifier(
  conScore: number,
  proficiencyBonus: number,
  saveProficiencies: readonly string[] = [],
): number {
  const conMod = Math.floor((conScore - 10) / 2);
  const conProf = saveProficiencies.includes("constitution")
    ? proficiencyBonus
    : 0;
  return conMod + conProf;
}

// ──────── Conditions that break concentration (D&D 5e 2024) ─────────
// Re-exported from domain for backward compatibility.
// Use the canonical domain version: domain/rules/concentration.ts
export { isConcentrationBreakingCondition } from "../../../../domain/rules/concentration.js";
