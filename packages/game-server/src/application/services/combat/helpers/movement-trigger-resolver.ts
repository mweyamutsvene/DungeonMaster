/**
 * Movement Trigger Resolver — processes on_voluntary_move ActiveEffects.
 *
 * When a creature with `triggerAt === 'on_voluntary_move'` effects starts to move,
 * this resolver fires each effect:
 *   1. Rolls a saving throw (if `triggerSave` is present)
 *   2. Rolls dice damage (if `diceValue` / `value` present)
 *   3. Applies damage through defenses (resistances, immunities, vulnerabilities)
 *   4. On a failed save (or no save), applies `triggerConditions`
 *   5. Removes the triggered effects from the combatant
 *   6. Persists HP changes, conditions, and handles KO
 *
 * This is a generic, source-agnostic resolver. Booming Blade, spike-growth debuffs,
 * or any future spell / ability that damages or conditions on voluntary movement
 * all use the same code path.
 */

import type { Ability } from "../../../../domain/entities/core/ability-scores.js";
import type { ActiveEffect } from "../../../../domain/entities/combat/effects.js";
import {
  getActiveEffects,
  setActiveEffects,
} from "./resource-utils.js";
import { applyDamageDefenses, type DamageDefenses } from "../../../../domain/rules/damage-defenses.js";
import {
  normalizeConditions,
  addCondition,
  createCondition,
  type Condition,
} from "../../../../domain/entities/combat/conditions.js";
import { applyKoEffectsIfNeeded } from "./ko-handler.js";
import type { CombatantStateRecord, JsonValue } from "../../../types.js";

// ── Types ──

export interface MovementTriggerEvent {
  effectId: string;
  source: string;
  damageType?: string;
  rawDamage: number;
  finalDamage: number;
  saveAbility?: string;
  saveDC?: number;
  saveRoll?: number;
  saveTotal?: number;
  saveSuccess: boolean;
  conditionsApplied: string[];
}

export interface MovementTriggerResult {
  /** True if the creature was reduced to 0 HP (abort the move) */
  aborted: boolean;
  /** Total damage dealt across all triggered effects */
  totalDamage: number;
  /** Human-readable messages for narration/logging */
  messages: string[];
  /** Detailed events for each effect that fired */
  events: MovementTriggerEvent[];
  /** Conditions that were applied */
  conditionsApplied: string[];
}

export interface MovementTriggerResolverDeps {
  /** Rolls a d20. Returns { total, rolls }. If undefined, saves auto-fail. */
  rollD20?: () => { total: number; rolls: number[] };
  /** Rolls damage dice. Returns total. If undefined, uses average. */
  rollDice?: (sides: number, count: number, modifier?: number) => number;
  /**
   * Returns the creature's saving-throw modifier for the given ability.
   * If undefined, modifier defaults to +0.
   */
  getSaveModifier?: (ability: Ability) => number;
  /** Damage defenses for the moving creature. If undefined, no defenses applied. */
  defenses?: DamageDefenses;
  /** Combat repository for persisting state changes */
  combatRepo: {
    updateCombatantState(
      id: string,
      patch: Partial<Pick<CombatantStateRecord, "hpCurrent" | "conditions" | "resources">>,
    ): Promise<CombatantStateRecord>;
  };
  debugLog?: boolean;
}

// ── Resolver ──

/**
 * Process on_voluntary_move ActiveEffects for a creature about to move.
 *
 * - Fires each matching effect (damage + save + conditions)
 * - Removes the triggered effects from the combatant's resources
 * - Persists HP, condition, and resource changes
 * - Returns whether the move should be aborted (creature KO'd)
 */
export async function resolveMovementTriggers(
  combatant: CombatantStateRecord,
  deps: MovementTriggerResolverDeps,
): Promise<MovementTriggerResult> {
  const effects = getActiveEffects(combatant.resources ?? {});
  const moveEffects = effects.filter(
    (e: ActiveEffect) => e.triggerAt === "on_voluntary_move",
  );

  if (moveEffects.length === 0) {
    return { aborted: false, totalDamage: 0, messages: [], events: [], conditionsApplied: [] };
  }

  let totalDamage = 0;
  const messages: string[] = [];
  const events: MovementTriggerEvent[] = [];
  const allConditionsApplied: string[] = [];
  let currentHP = combatant.hpCurrent;
  let conditions = normalizeConditions(combatant.conditions);

  for (const eff of moveEffects) {
    // ── 1. Saving throw ──
    let saveSuccess = false;
    let saveRoll: number | undefined;
    let saveTotal: number | undefined;

    if (eff.triggerSave) {
      if (deps.rollD20) {
        const roll = deps.rollD20();
        saveRoll = roll.rolls[0] ?? roll.total;
        const saveMod = deps.getSaveModifier
          ? deps.getSaveModifier(eff.triggerSave.ability)
          : 0;
        saveTotal = saveRoll + saveMod;
        saveSuccess = saveTotal >= eff.triggerSave.dc;
      }
      // If no d20 roller, saves auto-fail
    }

    // ── 2. Damage ──
    let rawDamage = eff.value ?? 0;
    if (eff.diceValue) {
      if (deps.rollDice) {
        rawDamage += deps.rollDice(eff.diceValue.sides, eff.diceValue.count);
      } else {
        // Fallback: average damage
        rawDamage += Math.floor(
          eff.diceValue.count * ((eff.diceValue.sides + 1) / 2),
        );
      }
    }

    // Apply save result to damage
    if (saveSuccess) {
      if (eff.triggerSave?.halfDamageOnSave) {
        rawDamage = Math.floor(rawDamage / 2);
      } else {
        rawDamage = 0; // Full negation on save
      }
    }

    // Apply damage defenses
    const defenses = deps.defenses ?? {};
    const defResult = applyDamageDefenses(rawDamage, eff.damageType, defenses);
    const finalDamage = defResult.adjustedDamage;
    totalDamage += finalDamage;

    // ── 3. Conditions (only on failed save or no save) ──
    const conditionsApplied: string[] = [];
    if (!saveSuccess && eff.triggerConditions && eff.triggerConditions.length > 0) {
      for (const condName of eff.triggerConditions) {
        const newCond = createCondition(condName as Condition, "until_removed", {
          source: eff.source ?? "Movement trigger",
        });
        conditions = addCondition(conditions, newCond);
        conditionsApplied.push(condName);
        allConditionsApplied.push(condName);
      }
    }

    // Build message
    const sourceName = eff.source ?? "Movement trigger";
    const parts: string[] = [];
    if (finalDamage > 0) {
      parts.push(`${finalDamage} ${eff.damageType ?? ""} damage`.trim());
    }
    if (saveSuccess && eff.triggerSave) {
      parts.push(`(${eff.triggerSave.ability.toUpperCase()} save succeeded)`);
    } else if (!saveSuccess && eff.triggerSave) {
      parts.push(`(${eff.triggerSave.ability.toUpperCase()} save failed)`);
    }
    if (conditionsApplied.length > 0) {
      parts.push(`applies ${conditionsApplied.join(", ")}`);
    }
    messages.push(
      `${sourceName} deals ${parts.join(", ") || "no effect"}!`,
    );

    events.push({
      effectId: eff.id,
      source: sourceName,
      damageType: eff.damageType,
      rawDamage: eff.diceValue ? (eff.value ?? 0) + (rawDamage - (eff.value ?? 0)) : rawDamage,
      finalDamage,
      saveAbility: eff.triggerSave?.ability,
      saveDC: eff.triggerSave?.dc,
      saveRoll,
      saveTotal,
      saveSuccess,
      conditionsApplied,
    });

    if (deps.debugLog) {
      console.log(
        `[MovementTrigger] ${sourceName}: ${finalDamage} ${eff.damageType ?? ""} damage${saveSuccess ? " (saved)" : ""}${conditionsApplied.length > 0 ? ` + ${conditionsApplied.join(",")}` : ""}`,
      );
    }
  }

  // ── 4. Remove triggered effects from resources ──
  const remaining = effects.filter(
    (e: ActiveEffect) => e.triggerAt !== "on_voluntary_move",
  );
  let updatedRes = setActiveEffects(combatant.resources ?? {}, remaining);

  // ── 5. Persist conditions ──
  if (allConditionsApplied.length > 0) {
    await deps.combatRepo.updateCombatantState(combatant.id, {
      conditions: conditions as unknown as JsonValue,
    });
  }

  // ── 6. Persist resource changes (effects removed) ──
  await deps.combatRepo.updateCombatantState(combatant.id, {
    resources: updatedRes as JsonValue,
  });

  // ── 7. Apply damage + KO ──
  if (totalDamage > 0) {
    const newHP = Math.max(0, currentHP - totalDamage);
    await deps.combatRepo.updateCombatantState(combatant.id, {
      hpCurrent: newHP,
    });
    await applyKoEffectsIfNeeded(combatant as any, currentHP, newHP, deps.combatRepo);

    if (newHP <= 0) {
      return { aborted: true, totalDamage, messages, events, conditionsApplied: allConditionsApplied };
    }
  }

  return { aborted: false, totalDamage, messages, events, conditionsApplied: allConditionsApplied };
}
