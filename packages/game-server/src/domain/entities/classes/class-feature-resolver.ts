/**
 * ClassFeatureResolver - Centralized logic for class-specific features.
 *
 * This module consolidates class feature calculations (Monk Ki, Martial Arts, Flurry of Blows, etc.)
 * that were previously scattered across route handlers.
 */

import { getMartialArtsDieSize } from "../../rules/martial-arts-die.js";
import type { ClassCapability } from "./class-definition.js";
import { isCharacterClassId } from "./class-definition.js";
import { hasDangerSense as barbarianHasDangerSense, hasFeralInstinct as barbarianHasFeralInstinct } from "./barbarian.js";
import { kiPointsForLevel } from "./monk.js";
import { getClassDefinition } from "./registry.js";

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
   * Check if a character is a Fighter.
   */
  static isFighter(sheet: CharacterSheetLike | null | undefined, className?: string | null): boolean {
    const name = className ?? sheet?.className ?? "";
    return name.toLowerCase() === "fighter";
  }

  /**
   * Check if a character is a Rogue.
   */
  static isRogue(sheet: CharacterSheetLike | null | undefined, className?: string | null): boolean {
    const name = className ?? sheet?.className ?? "";
    return name.toLowerCase() === "rogue";
  }

  /**
   * Check if a character is a Barbarian.
   */
  static isBarbarian(sheet: CharacterSheetLike | null | undefined, className?: string | null): boolean {
    const name = className ?? sheet?.className ?? "";
    return name.toLowerCase() === "barbarian";
  }

  /**
   * Check if a character is a Paladin.
   */
  static isPaladin(sheet: CharacterSheetLike | null | undefined, className?: string | null): boolean {
    const name = className ?? sheet?.className ?? "";
    return name.toLowerCase() === "paladin";
  }

  /**
   * Check if a character is a Cleric.
   */
  static isCleric(sheet: CharacterSheetLike | null | undefined, className?: string | null): boolean {
    const name = className ?? sheet?.className ?? "";
    return name.toLowerCase() === "cleric";
  }

  /**
   * Check if a character has Rage (Barbarian level 1+).
   */
  static hasRage(sheet: CharacterSheetLike | null | undefined, className?: string | null, level?: number): boolean {
    if (!ClassFeatureResolver.isBarbarian(sheet, className)) return false;
    const effectiveLevel = ClassFeatureResolver.getLevel(sheet, level);
    return effectiveLevel >= 1;
  }

  /**
   * Check if a character has Reckless Attack (Barbarian level 2+).
   */
  static hasRecklessAttack(sheet: CharacterSheetLike | null | undefined, className?: string | null, level?: number): boolean {
    if (!ClassFeatureResolver.isBarbarian(sheet, className)) return false;
    const effectiveLevel = ClassFeatureResolver.getLevel(sheet, level);
    return effectiveLevel >= 2;
  }

  /**
   * Check if a character has Divine Smite (Paladin level 2+).
   */
  static hasDivineSmite(sheet: CharacterSheetLike | null | undefined, className?: string | null, level?: number): boolean {
    if (!ClassFeatureResolver.isPaladin(sheet, className)) return false;
    const effectiveLevel = ClassFeatureResolver.getLevel(sheet, level);
    return effectiveLevel >= 2;
  }

  /**
   * Check if a character has Lay on Hands (Paladin level 1+).
   */
  static hasLayOnHands(sheet: CharacterSheetLike | null | undefined, className?: string | null): boolean {
    return ClassFeatureResolver.isPaladin(sheet, className);
  }

  /**
   * Check if a character has Channel Divinity.
   * Cleric level 2+, Paladin level 3+.
   */
  static hasChannelDivinity(sheet: CharacterSheetLike | null | undefined, className?: string | null, level?: number): boolean {
    const effectiveLevel = ClassFeatureResolver.getLevel(sheet, level);
    if (ClassFeatureResolver.isCleric(sheet, className)) return effectiveLevel >= 2;
    if (ClassFeatureResolver.isPaladin(sheet, className)) return effectiveLevel >= 3;
    return false;
  }

  /**
   * Check if a character has Cunning Action (Rogue level 2+).
   * Allows Hide, Dash, or Disengage as a bonus action.
   */
  static hasCunningAction(sheet: CharacterSheetLike | null | undefined, className?: string | null, level?: number): boolean {
    if (!ClassFeatureResolver.isRogue(sheet, className)) return false;
    const effectiveLevel = ClassFeatureResolver.getLevel(sheet, level);
    return effectiveLevel >= 2;
  }

  /**
   * Check if a character has Danger Sense (Barbarian level 2+).
   * Advantage on DEX saving throws against effects you can see.
   */
  static hasDangerSense(sheet: CharacterSheetLike | null | undefined, className?: string | null, level?: number): boolean {
    if (!ClassFeatureResolver.isBarbarian(sheet, className)) return false;
    const effectiveLevel = ClassFeatureResolver.getLevel(sheet, level);
    return barbarianHasDangerSense(effectiveLevel);
  }

  /**
   * Check if a character has Feral Instinct (Barbarian level 7+).
   * Advantage on initiative; can't be surprised unless incapacitated.
   */
  static hasFeralInstinct(sheet: CharacterSheetLike | null | undefined, className?: string | null, level?: number): boolean {
    if (!ClassFeatureResolver.isBarbarian(sheet, className)) return false;
    const effectiveLevel = ClassFeatureResolver.getLevel(sheet, level);
    return barbarianHasFeralInstinct(effectiveLevel);
  }

  /**
   * Check if a character is a martial class that gets Extra Attack at level 5.
   * Includes Fighter, Monk, Ranger, Paladin, Barbarian.
   */
  static hasMartialExtraAttack(sheet: CharacterSheetLike | null | undefined, className?: string | null): boolean {
    const name = (className ?? sheet?.className ?? "").toLowerCase();
    return ["fighter", "monk", "ranger", "paladin", "barbarian"].includes(name);
  }

  /**
   * Get the number of attacks per Attack action for a character.
   * Based on Extra Attack feature and Fighter's Two/Three Extra Attacks.
   */
  static getAttacksPerAction(sheet: CharacterSheetLike | null | undefined, className?: string | null, level?: number): number {
    const effectiveLevel = ClassFeatureResolver.getLevel(sheet, level);
    const isFighter = ClassFeatureResolver.isFighter(sheet, className);
    const hasMartial = ClassFeatureResolver.hasMartialExtraAttack(sheet, className);

    // Fighter gets more attacks at higher levels (D&D 2024)
    if (isFighter) {
      if (effectiveLevel >= 20) return 4; // Three Extra Attacks
      if (effectiveLevel >= 11) return 3; // Two Extra Attacks
      if (effectiveLevel >= 5) return 2;  // Extra Attack
      return 1;
    }

    // Other martial classes get Extra Attack at level 5
    if (hasMartial && effectiveLevel >= 5) return 2;

    // Default: 1 attack per action
    return 1;
  }

  /**
   * Check if a character has Action Surge available (Fighter level 2+).
   */
  static hasActionSurge(sheet: CharacterSheetLike | null | undefined, className?: string | null, level?: number): boolean {
    if (!ClassFeatureResolver.isFighter(sheet, className)) return false;
    const effectiveLevel = ClassFeatureResolver.getLevel(sheet, level);
    return effectiveLevel >= 2;
  }

  /**
   * Get Action Surge uses per short rest (Fighter level 2+: 1 use, level 17+: 2 uses).
   */
  static getActionSurgeUses(sheet: CharacterSheetLike | null | undefined, className?: string | null, level?: number): number {
    if (!ClassFeatureResolver.isFighter(sheet, className)) return 0;
    const effectiveLevel = ClassFeatureResolver.getLevel(sheet, level);
    if (effectiveLevel >= 17) return 2;
    if (effectiveLevel >= 2) return 1;
    return 0;
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
   * Check if a character has Open Hand Technique (Monk level 3+ with Way of the Open Hand subclass).
   */
  static hasOpenHandTechnique(
    sheet: CharacterSheetLike | null | undefined,
    className?: string | null,
    subclass?: string | null,
    level?: number,
  ): boolean {
    if (!ClassFeatureResolver.isMonk(sheet, className)) return false;
    const effectiveLevel = ClassFeatureResolver.getLevel(sheet, level);
    if (effectiveLevel < 3) return false;
    const sub = subclass ?? sheet?.subclass ?? "";
    return sub.toLowerCase().replace(/\s+/g, "") === "openhand";
  }

  /**
   * Check if a character has Stunning Strike (Monk level 5+, no subclass requirement).
   */
  static hasStunningStrike(
    sheet: CharacterSheetLike | null | undefined,
    className?: string | null,
    level?: number,
  ): boolean {
    if (!ClassFeatureResolver.isMonk(sheet, className)) return false;
    const effectiveLevel = ClassFeatureResolver.getLevel(sheet, level);
    return effectiveLevel >= 5;
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
   * Check if a character has Deflect Attacks (Monk level 3+).
   * Allows the Monk to use a reaction to reduce damage from a melee or ranged attack.
   */
  static hasDeflectAttacks(sheet: CharacterSheetLike | null | undefined, className?: string | null, level?: number): boolean {
    if (!ClassFeatureResolver.isMonk(sheet, className)) return false;
    const effectiveLevel = ClassFeatureResolver.getLevel(sheet, level);
    return effectiveLevel >= 3;
  }

  /**
   * Check if a character has Uncanny Metabolism (Monk level 2+).
   * On initiative, regain all Focus Points (ki) and heal for martial arts die + Monk level.
   */
  static hasUncannyMetabolism(sheet: CharacterSheetLike | null | undefined, className?: string | null, level?: number): boolean {
    if (!ClassFeatureResolver.isMonk(sheet, className)) return false;
    const effectiveLevel = ClassFeatureResolver.getLevel(sheet, level);
    return effectiveLevel >= 2;
  }

  /**
   * Get class capabilities for any class at a given level.
   * Delegates to the domain class definition's capabilitiesForLevel method.
   * Replaces Monk-specific getMonkCapabilities with a generic approach.
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
   * @deprecated Use getClassCapabilities() instead. This is a backwards-compatible alias.
   */
  static getMonkCapabilities(
    sheet: CharacterSheetLike | null | undefined,
    className?: string | null,
    level?: number,
  ): readonly ClassCapability[] {
    if (!ClassFeatureResolver.isMonk(sheet, className)) return [];
    return ClassFeatureResolver.getClassCapabilities(sheet, className, level);
  }
}
