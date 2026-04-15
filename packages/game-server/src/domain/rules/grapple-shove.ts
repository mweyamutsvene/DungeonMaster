/**
 * D&D 5e 2024 Grapple and Shove Mechanics
 *
 * Rules (2024):
 * - Both use your Unarmed Strike (replaces one attack if you have Extra Attack)
 * - Attacker makes an Unarmed Strike attack roll (d20 + STR mod + prof bonus) vs target AC
 * - On hit, instead of dealing damage:
 *   - Grapple/shove DC = 8 + attacker's STR mod + attacker's proficiency bonus
 *   - Target makes a STR or DEX saving throw (their choice, whichever is higher)
 *   - If the save fails, the grapple/shove succeeds
 * - Target must be no more than one size larger than you
 * - Grapple requires at least one free hand
 *
 * Escape Grapple (2024):
 * - DC = 8 + grappler's STR mod + grappler's proficiency bonus
 * - Escapee rolls Athletics (STR) or Acrobatics (DEX), picks higher
 */

import type { DiceRoller } from "./dice-roller.js";
import { abilityCheck } from "./ability-checks.js";
import { rollD20, type RollMode } from "./advantage.js";

/** Options to thread condition-based modifiers into grapple/shove rolls. */
export interface GrappleShoveOptions {
  /** Roll mode for the attacker's Unarmed Strike (Poisoned → disadvantage). */
  attackerMode?: RollMode;
  /** Flat d20 penalty for the attacker (Exhaustion, negative value). */
  attackerD20Penalty?: number;
  /** Roll mode for the target's saving throw (Poisoned → disadvantage). */
  targetSaveMode?: RollMode;
  /** Flat d20 penalty for the target's save (Exhaustion, negative value). */
  targetSavePenalty?: number;
  /** When true, target auto-fails the STR/DEX save (Stunned/Paralyzed/Petrified/Unconscious). */
  targetAutoFail?: boolean;
}

/** Options to thread condition-based modifiers into escape-grapple rolls. */
export interface EscapeGrappleOptions {
  /** Roll mode for the escapee's ability check (Poisoned → disadvantage). */
  mode?: RollMode;
  /** Flat d20 penalty for the escapee (Exhaustion, negative value). */
  d20Penalty?: number;
}

export interface GrappleShoveResult {
  success: boolean;
  /** The Unarmed Strike attack roll (d20 raw) */
  attackRoll: number;
  /** attackRoll + STR mod + prof bonus (total attack) */
  attackTotal: number;
  /** Target's AC */
  targetAC: number;
  /** Whether the Unarmed Strike hit */
  hit: boolean;
  /** DC for the saving throw (8 + STR mod + prof), only meaningful if hit */
  dc: number;
  /** The raw d20 roll on the saving throw (0 if attack missed) */
  saveRoll: number;
  /** saveRoll + modifier (the total the target achieved, 0 if attack missed) */
  total: number;
  /** Which ability the target used for their save */
  abilityUsed: "strength" | "dexterity";
  reason?: string;
}

/** Result for escape grapple — no attack roll involved */
export interface EscapeGrappleResult {
  success: boolean;
  dc: number;
  saveRoll: number;
  total: number;
  abilityUsed: "strength" | "dexterity";
  reason?: string;
}

/**
 * Resolve a grapple attempt (2024 rules).
 * Step 1: Unarmed Strike attack roll (d20 + STR mod + prof) vs target AC.
 * Step 2 (on hit): Target makes STR or DEX save vs DC (8 + attacker STR mod + prof).
 */
export function grappleTarget(
  attackerStrMod: number,
  attackerProfBonus: number,
  targetAC: number,
  targetStrMod: number,
  targetDexMod: number,
  targetTooLarge: boolean,
  hasFreeHand: boolean,
  diceRoller: DiceRoller,
  options?: GrappleShoveOptions,
): GrappleShoveResult {
  const missResult: GrappleShoveResult = {
    success: false, attackRoll: 0, attackTotal: 0, targetAC, hit: false,
    dc: 0, saveRoll: 0, total: 0, abilityUsed: "strength",
  };

  if (targetTooLarge) {
    return { ...missResult, reason: "Target is too large to grapple" };
  }
  if (!hasFreeHand) {
    return { ...missResult, reason: "You need at least one free hand to grapple" };
  }

  return resolveUnarmedStrike(attackerStrMod, attackerProfBonus, targetAC, targetStrMod, targetDexMod, diceRoller, options);
}

/**
 * Resolve a shove attempt (2024 rules).
 * Step 1: Unarmed Strike attack roll (d20 + STR mod + prof) vs target AC.
 * Step 2 (on hit): Target makes STR or DEX save vs DC (8 + attacker STR mod + prof).
 */
export function shoveTarget(
  attackerStrMod: number,
  attackerProfBonus: number,
  targetAC: number,
  targetStrMod: number,
  targetDexMod: number,
  targetTooLarge: boolean,
  diceRoller: DiceRoller,
  options?: GrappleShoveOptions,
): GrappleShoveResult {
  if (targetTooLarge) {
    return {
      success: false, attackRoll: 0, attackTotal: 0, targetAC, hit: false,
      dc: 0, saveRoll: 0, total: 0, abilityUsed: "strength",
      reason: "Target is too large to shove",
    };
  }

  return resolveUnarmedStrike(attackerStrMod, attackerProfBonus, targetAC, targetStrMod, targetDexMod, diceRoller, options);
}

/**
 * Resolve an escape-grapple attempt (2024 rules).
 * DC = 8 + grappler's STR mod + grappler's proficiency bonus.
 * Escapee rolls Athletics (STR) or Acrobatics (DEX) — picks higher total.
 *
 * When skill proficiency info is provided, the proficiency bonus is added to
 * the relevant ability modifier when the escapee is proficient in that skill.
 */
export function escapeGrapple(
  grapplerStrMod: number,
  grapplerProfBonus: number,
  escapeeStrMod: number,
  escapeeDexMod: number,
  diceRoller: DiceRoller,
  skillProficiency?: {
    athleticsBonus?: number;
    acrobaticsBonus?: number;
  },
  options?: EscapeGrappleOptions,
): EscapeGrappleResult {
  const dc = 8 + grapplerStrMod + grapplerProfBonus;

  // Athletics total = STR mod + athletics proficiency bonus (if proficient)
  const athleticsTotal = escapeeStrMod + (skillProficiency?.athleticsBonus ?? 0);
  // Acrobatics total = DEX mod + acrobatics proficiency bonus (if proficient)
  const acrobaticsTotal = escapeeDexMod + (skillProficiency?.acrobaticsBonus ?? 0);

  // Escapee picks the skill that gives the higher total modifier
  const useDex = acrobaticsTotal > athleticsTotal;
  // Apply exhaustion flat penalty to the ability modifier
  const d20Penalty = options?.d20Penalty ?? 0;
  const mod = (useDex ? acrobaticsTotal : athleticsTotal) + d20Penalty;

  const saveCheck = abilityCheck(diceRoller, { dc, abilityModifier: mod, mode: options?.mode ?? "normal" });

  return {
    success: saveCheck.success,
    dc,
    saveRoll: saveCheck.chosen,
    total: saveCheck.total,
    abilityUsed: useDex ? "dexterity" : "strength",
  };
}

/**
 * Shared logic for grapple/shove (2024):
 * 1. Attacker rolls Unarmed Strike (d20 + STR mod + prof) vs target AC
 * 2. On hit, DC = 8 + attacker STR mod + attacker prof
 * 3. Target rolls STR or DEX save (picks higher) vs DC
 * 4. If save fails → grapple/shove succeeds
 */
function resolveUnarmedStrike(
  attackerStrMod: number,
  attackerProfBonus: number,
  targetAC: number,
  targetStrMod: number,
  targetDexMod: number,
  diceRoller: DiceRoller,
  options?: GrappleShoveOptions,
): GrappleShoveResult {
  // Step 1: Unarmed Strike attack roll (apply mode and flat penalty from conditions)
  const attackMode = options?.attackerMode ?? "normal";
  const attackPenalty = options?.attackerD20Penalty ?? 0;
  const attackOutcome = rollD20(diceRoller, attackMode);
  const attackRoll = attackOutcome.chosen;
  const attackTotal = attackRoll + attackerStrMod + attackerProfBonus + attackPenalty;

  // D&D 5e 2024: Natural 1 always misses, natural 20 always hits
  const naturalMiss = attackRoll === 1;
  const naturalHit = attackRoll === 20;
  const hit = !naturalMiss && (naturalHit || attackTotal >= targetAC);

  if (!hit) {
    return {
      success: false,
      attackRoll,
      attackTotal,
      targetAC,
      hit: false,
      dc: 0,
      saveRoll: 0,
      total: 0,
      abilityUsed: "strength",
      reason: "Unarmed Strike missed",
    };
  }

  // Step 2: Target saving throw vs DC (apply mode and flat penalty from conditions)
  // TODO: abilityCheck() should be replaced with proper saving throw logic (proficiency + nat 1/20 rules) in follow-up PR
  const dc = 8 + attackerStrMod + attackerProfBonus;

  // Auto-fail: Stunned/Paralyzed/Petrified/Unconscious targets auto-fail STR/DEX saves
  if (options?.targetAutoFail) {
    return {
      success: true,
      attackRoll,
      attackTotal,
      targetAC,
      hit: true,
      dc,
      saveRoll: 0,
      total: 0,
      abilityUsed: "strength",
    };
  }

  const useDex = targetDexMod > targetStrMod;
  const savePenalty = options?.targetSavePenalty ?? 0;
  const targetMod = (useDex ? targetDexMod : targetStrMod) + savePenalty;

  const saveCheck = abilityCheck(diceRoller, { dc, abilityModifier: targetMod, mode: options?.targetSaveMode ?? "normal" });

  return {
    success: !saveCheck.success, // target must BEAT the DC to resist → if target fails, grapple/shove succeeds
    attackRoll,
    attackTotal,
    targetAC,
    hit: true,
    dc,
    saveRoll: saveCheck.chosen,
    total: saveCheck.total,
    abilityUsed: useDex ? "dexterity" : "strength",
  };
}

/**
 * Check if target is too large to grapple/shove.
 * Target can be at most one size category larger than attacker.
 */
export function isTargetTooLarge(
  attackerSize: CreatureSize,
  targetSize: CreatureSize,
): boolean {
  const sizeOrder: CreatureSize[] = ["Tiny", "Small", "Medium", "Large", "Huge", "Gargantuan"];
  const attackerIndex = sizeOrder.indexOf(attackerSize);
  const targetIndex = sizeOrder.indexOf(targetSize);

  // Target can be at most 1 size larger
  return targetIndex > attackerIndex + 1;
}

export type CreatureSize = "Tiny" | "Small" | "Medium" | "Large" | "Huge" | "Gargantuan";
