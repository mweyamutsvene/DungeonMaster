/**
 * Apply class/subclass feature adjustments that mutate the character sheet
 * at creation time.
 *
 * Currently handles:
 *  - Draconic Resilience (Sorcerer / Draconic Sorcery): +1 HP per sorcerer level,
 *    and unarmored AC = 13 + DEX mod.
 *
 * Pure: takes a sheet snapshot, returns a new sheet.
 */

import { classHasFeature } from "./registry.js";
import {
  DRACONIC_RESILIENCE,
} from "./feature-keys.js";

interface AbilityScoresLike {
  strength?: number;
  dexterity?: number;
  constitution?: number;
  intelligence?: number;
  wisdom?: number;
  charisma?: number;
}

function abilityMod(score: number | undefined): number {
  if (typeof score !== "number") return 0;
  return Math.floor((score - 10) / 2);
}

/**
 * Enrich a sheet with class-feature-driven adjustments based on the character's
 * class / subclass / level. Safe to call for any class; no-op when no feature
 * applies.
 */
export function enrichSheetClassFeatures(
  sheet: Record<string, unknown>,
  level: number,
  className: string | null | undefined,
): Record<string, unknown> {
  if (!className) return sheet;
  const classId = className.toLowerCase();
  const subclass = typeof sheet.subclass === "string" ? sheet.subclass : undefined;

  const out: Record<string, unknown> = { ...sheet };

  // --- Draconic Resilience -------------------------------------------------
  if (classHasFeature(classId, DRACONIC_RESILIENCE, level, subclass)) {
    // +1 HP per sorcerer level (on top of existing maxHp).
    // Support both camelCase and lowercase HP keys for robustness.
    const readNum = (...keys: string[]): number | undefined => {
      for (const k of keys) {
        const v = out[k];
        if (typeof v === "number" && Number.isFinite(v)) return v;
      }
      return undefined;
    };
    const baseMax = readNum("maxHp", "maxHP", "hitPoints", "hp");
    if (typeof baseMax === "number") {
      const newMax = baseMax + level;
      out.maxHp = newMax;
      if ("maxHP" in out) out.maxHP = newMax;
      const curBefore = readNum("currentHp", "currentHP");
      // If current HP was at or above the old max, scale up to the new max.
      if (typeof curBefore !== "number" || curBefore >= baseMax) {
        out.currentHp = newMax;
        if ("currentHP" in out) out.currentHP = newMax;
      }
    }

    // Unarmored AC = 13 + DEX mod.
    const equipment = (out.equipment && typeof out.equipment === "object")
      ? (out.equipment as Record<string, unknown>)
      : undefined;
    const hasArmor = equipment?.armor !== undefined && equipment?.armor !== null;
    if (!hasArmor) {
      const abilityScores = (out.abilityScores && typeof out.abilityScores === "object")
        ? (out.abilityScores as AbilityScoresLike)
        : undefined;
      const dexMod = abilityMod(abilityScores?.dexterity);
      const draconicAc = 13 + dexMod;
      const existingAc = typeof out.armorClass === "number" ? out.armorClass : 10;
      out.armorClass = Math.max(existingAc, draconicAc);
    }
  }

  return out;
}
