/**
 * Generic "save-to-end" primitive.
 *
 * D&D 5e 2024 has many spells/features that impose a condition which the target
 * can retry saving against at the end of each of its turns: Hold Person, Hold
 * Monster, Sleep (2024), Suggestion, Hideous Laughter, Command, etc.
 *
 * This module provides a pure, deterministic primitive that resolves such a
 * save against an `ActiveEffect.saveToEnd` payload. It takes a `DiceRoller`
 * (so `QueueableDiceRoller` keeps E2E tests deterministic), a `Creature`
 * (for ability modifier + proficiency bonus), and the `ActiveEffect` itself.
 *
 * The caller is responsible for:
 *   - Removing the effect + any `removeConditions` from the creature on success.
 *   - Deciding the roll mode (advantage/disadvantage) based on active effects
 *     and conditions — this primitive takes it as input.
 *   - Looking up save proficiency and passing `proficient: true` when applicable.
 *
 * The primitive applies D&D 5e 2024 nat-20 auto-success and nat-1 auto-fail
 * rules via `savingThrowTest()`.
 */

import type { DiceRoller } from "./dice-roller.js";
import type { Creature } from "../entities/creatures/creature.js";
import type { ActiveEffect } from "../entities/combat/effects.js";
import { savingThrowTest, type RollMode } from "./advantage.js";

export interface SavingThrowMods {
  /** Add the creature's proficiency bonus to the save total. */
  readonly proficient?: boolean;
  /** Additional flat bonus (e.g., Paladin Aura of Protection, Bless). */
  readonly bonus?: number;
  /** Advantage/disadvantage, already aggregated by the caller. */
  readonly mode?: RollMode;
}

export interface SaveToEndResult {
  /** Whether the save succeeded (effect should be removed by caller). */
  readonly success: boolean;
  /** Final d20 total including all modifiers. */
  readonly totalRoll: number;
  /** The DC that was rolled against. */
  readonly dc: number;
  /** The chosen d20 value (after advantage/disadvantage). */
  readonly roll: number;
  /** Total modifier applied (ability + proficiency + bonus). */
  readonly modifier: number;
  /** True when chosen d20 was a natural 20 (auto-success). */
  readonly natural20: boolean;
  /** True when chosen d20 was a natural 1 (auto-fail). */
  readonly natural1: boolean;
}

/**
 * Resolve a save-to-end roll for an ActiveEffect with `saveToEnd` metadata.
 *
 * @throws if the effect does not carry `saveToEnd` metadata.
 */
export function resolveSaveToEnd(
  dice: DiceRoller,
  target: Creature,
  effect: ActiveEffect,
  modifiers: SavingThrowMods = {},
): SaveToEndResult {
  if (!effect.saveToEnd) {
    throw new Error("resolveSaveToEnd requires an effect with saveToEnd metadata");
  }
  const { ability, dc } = effect.saveToEnd;
  const abilityMod = target.getAbilityModifier(ability);
  const profMod = modifiers.proficient ? target.getProficiencyBonus() : 0;
  const extra = modifiers.bonus ?? 0;
  const totalMod = abilityMod + profMod + extra;
  const mode = modifiers.mode ?? "normal";
  const result = savingThrowTest(dice, dc, totalMod, mode);
  return {
    success: result.success,
    totalRoll: result.total,
    dc,
    roll: result.chosen,
    modifier: totalMod,
    natural20: result.natural20,
    natural1: result.natural1,
  };
}
