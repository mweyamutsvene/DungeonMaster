import { computePitFallDamage, getPitDepthOf, isPitEntry, PIT_DEX_SAVE_DC, type CombatMap } from "../../../../domain/rules/combat-map.js";
import { getAbilityModifier, savingThrow } from "../../../../domain/rules/ability-checks.js";
import type { RollMode } from "../../../../domain/rules/advantage.js";
import type { DiceRoller } from "../../../../domain/rules/dice-roller.js";
import {
  addCondition,
  createCondition,
  getConditionEffects,
  hasCondition,
  normalizeConditions,
  type ActiveCondition,
  type Condition,
} from "../../../../domain/entities/combat/conditions.js";
import type { Position } from "../../../../domain/rules/movement.js";

export interface PitEntryResolution {
  triggered: boolean;
  saved: boolean;
  damageApplied: number;
  /** Raw fall damage before Slow Fall / other reductions. Useful for narration. */
  damageBeforeReduction?: number;
  /** How much damage was reduced by Slow Fall (Monk L4+). 0 if not applicable. */
  slowFallReduction?: number;
  hpAfter: number;
  updatedConditions: ActiveCondition[];
  movementEnds: boolean;
  saveMode?: RollMode;
  saveRoll?: number;
  saveTotal?: number;
  depthFeet?: number;
}

/**
 * Optional class-aware fall-damage modifier inputs.
 * D&D 5e 2024:
 *  - Slow Fall (Monk L4+): reaction; reduces fall damage by 5 × Monk level.
 *    Implemented as auto-apply (skipping reaction prompt) since there's no
 *    reasonable case for declining it. Consumes the actor's reaction.
 */
export interface FallDamageContext {
  /** Monk levels, if any. 0 if non-monk or below L4. */
  monkLevel?: number;
  /** Whether the actor has a reaction available this round. */
  hasReaction?: boolean;
}

export function resolvePitEntry(
  map: CombatMap | undefined,
  from: Position,
  to: Position,
  dexterityScore: number,
  hpCurrent: number,
  rawConditions: unknown,
  diceRoller: DiceRoller,
  fallContext?: FallDamageContext,
): PitEntryResolution {
  const conditions = normalizeConditions(rawConditions);

  if (!map || !isPitEntry(map, from, to)) {
    return {
      triggered: false,
      saved: false,
      damageApplied: 0,
      hpAfter: hpCurrent,
      updatedConditions: conditions,
      movementEnds: false,
    };
  }

  const autoFailDexSave = conditions.some((c) => {
    const effects = getConditionEffects(c.condition);
    return effects.autoFailStrDexSaves;
  });

  const dexSaveDisadvantage = conditions.some((c) => {
    const effects = getConditionEffects(c.condition);
    return effects.savingThrowDisadvantage.includes("dexterity");
  });

  const saveMode: RollMode = dexSaveDisadvantage ? "disadvantage" : "normal";
  let saveRoll = 0;
  let saveTotal = 0;
  let saved = false;

  if (!autoFailDexSave) {
    const dexModifier = getAbilityModifier(dexterityScore);
    const save = savingThrow(diceRoller, PIT_DEX_SAVE_DC, dexModifier, saveMode);
    saveRoll = save.chosen;
    saveTotal = save.total;
    saved = save.success;
  }

  if (saved) {
    let updated = conditions;
    if (!hasCondition(updated, "Prone" as Condition)) {
      updated = addCondition(updated, createCondition("Prone" as Condition, "until_removed", {
        source: "Pit edge",
      }));
    }

    return {
      triggered: true,
      saved: true,
      damageApplied: 0,
      hpAfter: hpCurrent,
      updatedConditions: updated,
      movementEnds: true,
      saveMode,
      saveRoll,
      saveTotal,
      depthFeet: getPitDepthOf(map, to),
    };
  }

  const depthFeet = getPitDepthOf(map, to);
  const rawFallDamage = computePitFallDamage(depthFeet, diceRoller);

  // Slow Fall (Monk L4+, 2024): reduces fall damage by 5 × Monk level. Auto-applied
  // when the actor has reaction available; consumes the reaction (caller must spend it).
  let slowFallReduction = 0;
  if (
    fallContext?.monkLevel
    && fallContext.monkLevel >= 4
    && fallContext.hasReaction !== false
  ) {
    slowFallReduction = 5 * fallContext.monkLevel;
  }

  const damageApplied = Math.max(0, rawFallDamage - slowFallReduction);
  const hpAfter = Math.max(0, hpCurrent - damageApplied);

  return {
    triggered: true,
    saved: false,
    damageApplied,
    damageBeforeReduction: rawFallDamage,
    slowFallReduction,
    hpAfter,
    updatedConditions: conditions,
    movementEnds: true,
    saveMode,
    saveRoll: autoFailDexSave ? undefined : saveRoll,
    saveTotal: autoFailDexSave ? undefined : saveTotal,
    depthFeet,
  };
}
