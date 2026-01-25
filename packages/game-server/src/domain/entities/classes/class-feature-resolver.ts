/**
 * ClassFeatureResolver - Centralized logic for class-specific features.
 *
 * This module consolidates class feature calculations (Monk Ki, Martial Arts, Flurry of Blows, etc.)
 * that were previously scattered across route handlers.
 */

import { getMartialArtsDieSize } from "../../rules/martial-arts-die.js";
import { kiPointsForLevel } from "./monk.js";

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
 * ClassFeatureResolver provides static methods for resolving class-specific features.
 */
export class ClassFeatureResolver {
  /**
   * Check if a character is a Monk.
   */
  static isMonk(sheet: CharacterSheetLike | null | undefined, className?: string | null): boolean {
    const name = className ?? sheet?.className ?? "";
    return name.toLowerCase() === "monk";
  }

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
   * Get the Martial Arts die size for a Monk at a given level.
   * Returns 1 for non-monks (1d1 = flat 1 damage for unarmed).
   */
  static getMartialArtsDie(level: number, isMonk: boolean): number {
    return isMonk ? getMartialArtsDieSize(level) : 1;
  }

  /**
   * Get Ki points available for a Monk at a given level.
   * Returns 0 for non-monks or monks below level 2.
   */
  static getKiPoints(level: number, isMonk: boolean): number {
    if (!isMonk) return 0;
    return kiPointsForLevel(level);
  }

  /**
   * Check if a character has Flurry of Blows available (Monk level 2+).
   */
  static hasFlurryOfBlows(sheet: CharacterSheetLike | null | undefined, className?: string | null, level?: number): boolean {
    if (!ClassFeatureResolver.isMonk(sheet, className)) return false;
    const effectiveLevel = ClassFeatureResolver.getLevel(sheet, level);
    return effectiveLevel >= 2;
  }

  /**
   * Check if a character has Patient Defense available (Monk level 2+).
   */
  static hasPatientDefense(sheet: CharacterSheetLike | null | undefined, className?: string | null, level?: number): boolean {
    return ClassFeatureResolver.hasFlurryOfBlows(sheet, className, level); // Same requirement
  }

  /**
   * Check if a character has Step of the Wind available (Monk level 2+).
   */
  static hasStepOfTheWind(sheet: CharacterSheetLike | null | undefined, className?: string | null, level?: number): boolean {
    return ClassFeatureResolver.hasFlurryOfBlows(sheet, className, level); // Same requirement
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
    const isMonk = ClassFeatureResolver.isMonk(sheet, className);
    const effectiveLevel = ClassFeatureResolver.getLevel(sheet, level);
    const profBonus = ClassFeatureResolver.getProficiencyBonus(sheet, effectiveLevel);

    const str = sheet?.abilityScores?.strength ?? 10;
    const dex = sheet?.abilityScores?.dexterity ?? 10;
    const strMod = abilityModifier(str);
    const dexMod = abilityModifier(dex);

    // Monks can use DEX or STR for unarmed strikes
    const chosenMod = isMonk ? Math.max(strMod, dexMod) : strMod;
    const attackBonus = profBonus + (isMonk ? Math.max(strMod, dexMod) : strMod);

    const damageDie = ClassFeatureResolver.getMartialArtsDie(effectiveLevel, isMonk);
    const damageModifier = isMonk ? chosenMod : Math.max(0, strMod);

    const modText = damageModifier === 0 ? "" : damageModifier > 0 ? `+${damageModifier}` : `${damageModifier}`;
    const damageFormula = `1d${damageDie}${modText}`;

    return { attackBonus, damageDie, damageModifier, damageFormula };
  }

  /**
   * Get Monk-specific capabilities list for tactical context.
   */
  static getMonkCapabilities(
    sheet: CharacterSheetLike | null | undefined,
    className?: string | null,
    level?: number,
  ): Array<{
    name: string;
    economy: "action" | "bonusAction" | "reaction" | "free";
    cost?: string;
    requires?: string;
    effect: string;
  }> {
    if (!ClassFeatureResolver.isMonk(sheet, className)) return [];
    const effectiveLevel = ClassFeatureResolver.getLevel(sheet, level);
    if (effectiveLevel < 2) return [];

    const capabilities: Array<{
      name: string;
      economy: "action" | "bonusAction" | "reaction" | "free";
      cost?: string;
      requires?: string;
      effect: string;
    }> = [
      {
        name: "Flurry of Blows",
        economy: "bonusAction",
        cost: "1 ki",
        requires: "After you take the Attack action on your turn",
        effect: "Make two Unarmed Strikes",
      },
      {
        name: "Patient Defense",
        economy: "bonusAction",
        cost: "1 ki",
        requires: "On your turn",
        effect: "Take the Dodge action until the start of your next turn",
      },
      {
        name: "Step of the Wind",
        economy: "bonusAction",
        cost: "1 ki",
        requires: "On your turn",
        effect: "Take the Disengage or Dash action, and your jump distance is doubled",
      },
    ];

    // Add higher level features
    if (effectiveLevel >= 5) {
      capabilities.push({
        name: "Stunning Strike",
        economy: "free",
        cost: "1 ki",
        requires: "When you hit with a melee weapon attack",
        effect: "Target must succeed on CON save or be Stunned until end of your next turn",
      });
    }

    return capabilities;
  }
}
