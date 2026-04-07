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
  hpAfter: number;
  updatedConditions: ActiveCondition[];
  movementEnds: boolean;
  saveMode?: RollMode;
  saveRoll?: number;
  saveTotal?: number;
  depthFeet?: number;
}

export function resolvePitEntry(
  map: CombatMap | undefined,
  from: Position,
  to: Position,
  dexterityScore: number,
  hpCurrent: number,
  rawConditions: unknown,
  diceRoller: DiceRoller,
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
  const damageApplied = computePitFallDamage(depthFeet, diceRoller);
  const hpAfter = Math.max(0, hpCurrent - damageApplied);

  return {
    triggered: true,
    saved: false,
    damageApplied,
    hpAfter,
    updatedConditions: conditions,
    movementEnds: true,
    saveMode,
    saveRoll: autoFailDexSave ? undefined : saveRoll,
    saveTotal: autoFailDexSave ? undefined : saveTotal,
    depthFeet,
  };
}
