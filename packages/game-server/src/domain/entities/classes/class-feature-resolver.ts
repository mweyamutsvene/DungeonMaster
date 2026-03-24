/**
 * ClassFeatureResolver - Computed class-specific values.
 *
 * Boolean feature gates (hasRage, hasCunningAction, etc.) have been migrated to
 * the registry-based `classHasFeature()` / `hasFeature()` system. See registry.ts
 * and feature-keys.ts.
 *
 * This module retains only:
 * - Computed value methods that return numbers or complex objects
 * - Generic utility helpers (getLevel, getProficiencyBonus)
 * - The CharacterSheetLike type used by multiple consumers
 */

import { getMartialArtsDieSize } from "../../rules/martial-arts-die.js";
import type { ClassCapability } from "./class-definition.js";
import { isCharacterClassId } from "./class-definition.js";
import { classHasFeature, getClassDefinition } from "./registry.js";
import { EXTRA_ATTACK, TWO_EXTRA_ATTACKS, THREE_EXTRA_ATTACKS, MARTIAL_ARTS } from "./feature-keys.js";

/**
 * Character sheet type - minimal interface for feature resolution.
 */
export interface CharacterSheetLike {
  abilityScores?: {
    strength?: number;
    dexterity?: number;
    constitution?: number;
    intelligence?: number;
    wisdom?: number;
    charisma?: number;
  };
  proficiencyBonus?: number;
  level?: number;
  className?: string;
  subclass?: string;
  kiPoints?: number;
}

/**
 * Ability modifier calculation.
 */
export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/**
 * Get proficiency bonus by level (if not explicitly set on sheet).
 */
export function proficiencyBonusByLevel(level: number): number {
  return Math.floor((level - 1) / 4) + 2;
}

/**
 * ClassFeatureResolver provides static methods for computed class-specific values.
 *
 * For boolean feature checks, use `classHasFeature()` from registry.ts instead.
 */
export class ClassFeatureResolver {
  /**
   * Get the character's level.
   */
  static getLevel(sheet: CharacterSheetLike | null | undefined, characterLevel?: number): number {
    if (typeof characterLevel === "number" && characterLevel >= 1) return characterLevel;
    if (typeof sheet?.level === "number" && sheet.level >= 1) return sheet.level;
    return 1;
  }

  /**
   * Get proficiency bonus for a character.
   */
  static getProficiencyBonus(sheet: CharacterSheetLike | null | undefined, level?: number): number {
    if (typeof sheet?.proficiencyBonus === "number") return sheet.proficiencyBonus;
    const effectiveLevel = ClassFeatureResolver.getLevel(sheet, level);
    return proficiencyBonusByLevel(effectiveLevel);
  }

  /**
   * Get the number of attacks per Attack action for a character.
   * Uses the feature map for Extra Attack detection.
   */
  static getAttacksPerAction(sheet: CharacterSheetLike | null | undefined, className?: string | null, level?: number): number {
    const effectiveLevel = ClassFeatureResolver.getLevel(sheet, level);
    const name = (className ?? sheet?.className ?? "").toLowerCase();

    // Fighter gets more attacks at higher levels (D&D 2024)
    if (classHasFeature(name, THREE_EXTRA_ATTACKS, effectiveLevel)) return 4;
    if (classHasFeature(name, TWO_EXTRA_ATTACKS, effectiveLevel)) return 3;

    // All martial classes with Extra Attack at level 5
    if (classHasFeature(name, EXTRA_ATTACK, effectiveLevel)) return 2;

    // Default: 1 attack per action
    return 1;
  }

  /**
   * Get unarmed strike stats for a character.
   * Monks use Martial Arts die + DEX or STR (whichever is higher).
   * Non-monks deal 1 + STR mod (minimum 0).
   */
  static getUnarmedStrikeStats(
    sheet: CharacterSheetLike | null | undefined,
    className?: string | null,
    level?: number,
  ): {
    attackBonus: number;
    damageDie: number;
    damageModifier: number;
    damageFormula: string;
  } {
    const name = (className ?? sheet?.className ?? "").toLowerCase();
    const effectiveLevel = ClassFeatureResolver.getLevel(sheet, level);
    const isMonk = classHasFeature(name, MARTIAL_ARTS, effectiveLevel);
    const profBonus = ClassFeatureResolver.getProficiencyBonus(sheet, effectiveLevel);

    const str = sheet?.abilityScores?.strength ?? 10;
    const dex = sheet?.abilityScores?.dexterity ?? 10;
    const strMod = abilityModifier(str);
    const dexMod = abilityModifier(dex);

    // Monks can use DEX or STR for unarmed strikes
    const chosenMod = isMonk ? Math.max(strMod, dexMod) : strMod;
    const attackBonus = profBonus + chosenMod;

    const damageDie = isMonk ? getMartialArtsDieSize(effectiveLevel) : 1;
    const damageModifier = isMonk ? chosenMod : Math.max(0, strMod);

    const modText = damageModifier === 0 ? "" : damageModifier > 0 ? `+${damageModifier}` : `${damageModifier}`;
    const damageFormula = `1d${damageDie}${modText}`;

    return { attackBonus, damageDie, damageModifier, damageFormula };
  }

  /**
   * Get class capabilities for any class at a given level.
   * Delegates to the domain class definition's capabilitiesForLevel method.
   */
  static getClassCapabilities(
    sheet: CharacterSheetLike | null | undefined,
    className?: string | null,
    level?: number,
  ): readonly ClassCapability[] {
    const name = (className ?? sheet?.className ?? "").toLowerCase();
    if (!name || !isCharacterClassId(name)) return [];
    const classDef = getClassDefinition(name);
    if (!classDef.capabilitiesForLevel) return [];
    const effectiveLevel = ClassFeatureResolver.getLevel(sheet, level);
    return classDef.capabilitiesForLevel(effectiveLevel);
  }

  /**
   * Check if a character has Open Hand Technique (Monk level 3+ with Way of the Open Hand subclass).
   * Kept as a method because it has a subclass requirement that can't be expressed in the features map alone.
   */
  static hasOpenHandTechnique(
    sheet: CharacterSheetLike | null | undefined,
    className?: string | null,
    subclass?: string | null,
    level?: number,
  ): boolean {
    const name = (className ?? sheet?.className ?? "").toLowerCase();
    const effectiveLevel = ClassFeatureResolver.getLevel(sheet, level);
    if (!classHasFeature(name, "open-hand-technique", effectiveLevel)) return false;
    const sub = subclass ?? sheet?.subclass ?? "";
    return sub.toLowerCase().replace(/\s+/g, "") === "openhand";
  }
}
