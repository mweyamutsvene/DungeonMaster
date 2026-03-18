/**
 * KO Handler — shared logic for applying Unconscious + Prone + death saves
 * when a CHARACTER drops to 0 HP.
 *
 * D&D 5e 2024: When a character drops to 0 HP from above 0, they fall Unconscious,
 * gain the Prone condition, and begin making death saving throws.
 *
 * This centralizes the KO logic that was previously only in the player-flow
 * (RollStateMachine.handleDamageRoll) so that AI attacks and reaction damage
 * also properly apply these effects.
 */

import {
  normalizeConditions,
  addCondition,
  createCondition,
  type Condition,
} from "../../../../domain/entities/combat/conditions.js";
import { resetDeathSaves, takeDamageWhileUnconscious, type DeathSaves } from "../../../../domain/rules/death-saves.js";
import { normalizeResources } from "./resource-utils.js";
import type { JsonValue, CombatantStateRecord } from "../../../types.js";

/**
 * Minimal interface for the combat repository – only the method we need.
 */
export interface KoHandlerCombatRepo {
  updateCombatantState(
    id: string,
    patch: Partial<Pick<CombatantStateRecord, "hpCurrent" | "conditions" | "resources">>,
  ): Promise<CombatantStateRecord>;
}

/**
 * Apply KO effects if a character just dropped to 0 HP.
 *
 * Call this AFTER reducing hpCurrent to 0 via updateCombatantState.
 * It will apply Unconscious + Prone and initialize death saves.
 *
 * @param combatant - The combatant whose HP was just reduced
 * @param hpBefore  - HP before the damage was applied
 * @param hpAfter   - HP after the damage (should be 0)
 * @param combatRepo - Repository for persisting state changes
 * @param debugLog  - Optional debug logger
 * @returns true if KO effects were applied
 */
export async function applyKoEffectsIfNeeded(
  combatant: CombatantStateRecord,
  hpBefore: number,
  hpAfter: number,
  combatRepo: KoHandlerCombatRepo,
  debugLog?: (msg: string) => void,
): Promise<boolean> {
  // Only applies to Characters dropping from above-0 to exactly 0
  if (hpAfter !== 0 || hpBefore <= 0 || combatant.combatantType !== "Character") {
    return false;
  }

  const resources = normalizeResources(combatant.resources);
  const updatedResources: JsonValue = {
    ...resources,
    deathSaves: resetDeathSaves(),
    stabilized: false,
  };

  let conditions = normalizeConditions(combatant.conditions);
  conditions = addCondition(conditions, createCondition("Unconscious" as Condition, "until_removed"));
  conditions = addCondition(conditions, createCondition("Prone" as Condition, "until_removed"));

  await combatRepo.updateCombatantState(combatant.id, {
    resources: updatedResources,
    conditions: conditions as any,
  });

  debugLog?.(`Character ${combatant.id} dropped to 0 HP — death saves initialized, Unconscious+Prone applied`);
  return true;
}

/**
 * Apply damage-while-unconscious effects (auto-fail death saves).
 *
 * Call this when a character already at 0 HP takes additional damage.
 *
 * @param combatant   - The combatant at 0 HP being hit again
 * @param totalDamage - Total damage dealt
 * @param isCritical  - Whether the attack was a critical hit
 * @param combatRepo  - Repository for persisting state changes
 * @param debugLog    - Optional debug logger
 * @returns Object with updated death saves and whether instant death occurred
 */
export async function applyDamageWhileUnconscious(
  combatant: CombatantStateRecord,
  totalDamage: number,
  isCritical: boolean,
  combatRepo: KoHandlerCombatRepo,
  debugLog?: (msg: string) => void,
): Promise<{ deathSaves: DeathSaves; instantDeath: boolean }> {
  const resources = normalizeResources(combatant.resources);
  const currentDS: DeathSaves = (resources as any).deathSaves ?? resetDeathSaves();
  const { deathSaves: updatedDS, instantDeath } = takeDamageWhileUnconscious(
    currentDS,
    totalDamage,
    isCritical,
    combatant.hpMax,
  );

  await combatRepo.updateCombatantState(combatant.id, {
    resources: { ...resources, deathSaves: updatedDS },
  });

  if (instantDeath) {
    debugLog?.(`Character ${combatant.id} killed by massive damage while unconscious`);
  }

  return { deathSaves: updatedDS, instantDeath };
}
