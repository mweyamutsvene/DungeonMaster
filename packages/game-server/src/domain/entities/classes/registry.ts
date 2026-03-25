import type { CharacterClassDefinition, CharacterClassId, SubclassDefinition } from "./class-definition.js";
import { isCharacterClassId } from "./class-definition.js";
import type { ClassCombatTextProfile } from "./combat-text-profile.js";
import { IMPROVED_CRITICAL, SUPERIOR_CRITICAL } from "./feature-keys.js";

import { Barbarian, BARBARIAN_COMBAT_TEXT_PROFILE } from "./barbarian.js";
import { Bard } from "./bard.js";
import { Cleric, CLERIC_COMBAT_TEXT_PROFILE } from "./cleric.js";
import { Druid } from "./druid.js";
import { Fighter, FIGHTER_COMBAT_TEXT_PROFILE } from "./fighter.js";
import { Monk, MONK_COMBAT_TEXT_PROFILE } from "./monk.js";
import { Paladin, PALADIN_COMBAT_TEXT_PROFILE } from "./paladin.js";
import { Ranger } from "./ranger.js";
import { Rogue, ROGUE_COMBAT_TEXT_PROFILE } from "./rogue.js";
import { Sorcerer } from "./sorcerer.js";
import { Warlock, WARLOCK_COMBAT_TEXT_PROFILE } from "./warlock.js";
import { Wizard, WIZARD_COMBAT_TEXT_PROFILE } from "./wizard.js";

const CLASS_DEFINITIONS: Record<CharacterClassId, CharacterClassDefinition> = {
  barbarian: Barbarian,
  bard: Bard,
  cleric: Cleric,
  druid: Druid,
  fighter: Fighter,
  monk: Monk,
  paladin: Paladin,
  ranger: Ranger,
  rogue: Rogue,
  sorcerer: Sorcerer,
  warlock: Warlock,
  wizard: Wizard,
};

export function getClassDefinition(classId: CharacterClassId): CharacterClassDefinition {
  return CLASS_DEFINITIONS[classId];
}

// ----- Subclass normalization -----

/**
 * Normalize a subclass identifier for comparison.
 * Strips to lowercase alphanumeric (no spaces, hyphens, or special chars).
 * "Open Hand" → "openhand", "open-hand" → "openhand", "Champion" → "champion".
 */
function normalizeSubclassId(id: string): string {
  return id.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ----- Subclass lookup helpers -----

/**
 * Get a subclass definition by classId and subclassId.
 * Normalizes both IDs for safe matching.
 */
export function getSubclassDefinition(classId: string, subclassId: string): SubclassDefinition | undefined {
  const normalized = classId.toLowerCase();
  if (!isCharacterClassId(normalized)) return undefined;
  const def = CLASS_DEFINITIONS[normalized];
  if (!def.subclasses) return undefined;
  const subNorm = normalizeSubclassId(subclassId);
  return def.subclasses.find(s => normalizeSubclassId(s.id) === subNorm);
}

// ----- Feature lookup helpers -----

/**
 * Check if a single class (and optionally its subclass) grants a feature at the given level.
 * Normalizes classId to lowercase for safe lookup.
 * When subclassId is provided, also checks the subclass's features map.
 */
export function classHasFeature(classId: string, feature: string, classLevel: number, subclassId?: string): boolean {
  const normalized = classId.toLowerCase();
  if (!isCharacterClassId(normalized)) return false;
  const def = CLASS_DEFINITIONS[normalized];

  // Check class-level features
  const minLevel = def.features?.[feature];
  if (minLevel !== undefined && classLevel >= minLevel) return true;

  // Check subclass features if subclassId provided
  if (subclassId) {
    const sub = getSubclassDefinition(normalized, subclassId);
    if (sub) {
      const subMinLevel = sub.features[feature];
      if (subMinLevel !== undefined && classLevel >= subMinLevel) return true;
    }
  }

  return false;
}

/**
 * Multi-class-ready: check if ANY of the character's class-level entries grant a feature.
 */
export function hasFeature(classLevels: ReadonlyArray<{ classId: string; level: number }>, feature: string): boolean {
  return classLevels.some(({ classId, level }) => classHasFeature(classId, feature, level));
}

/**
 * Get the minimum class level required for a feature, or undefined if the class
 * doesn't grant it at all. Useful for computed methods that need the threshold.
 */
export function getClassFeatureLevel(classId: string, feature: string): number | undefined {
  const normalized = classId.toLowerCase();
  if (!isCharacterClassId(normalized)) return undefined;
  return CLASS_DEFINITIONS[normalized].features?.[feature];
}

// ----- Combat text profile registry -----

/**
 * All registered class combat text profiles.
 * When adding a new class with combat abilities, add its profile here.
 */
const COMBAT_TEXT_PROFILES: readonly ClassCombatTextProfile[] = [
  MONK_COMBAT_TEXT_PROFILE,
  FIGHTER_COMBAT_TEXT_PROFILE,
  WIZARD_COMBAT_TEXT_PROFILE,
  WARLOCK_COMBAT_TEXT_PROFILE,
  BARBARIAN_COMBAT_TEXT_PROFILE,
  PALADIN_COMBAT_TEXT_PROFILE,
  CLERIC_COMBAT_TEXT_PROFILE,
  ROGUE_COMBAT_TEXT_PROFILE,
];

/** Get all registered combat text profiles (class + subclass). */
export function getAllCombatTextProfiles(): readonly ClassCombatTextProfile[] {
  const allProfiles: ClassCombatTextProfile[] = [...COMBAT_TEXT_PROFILES];

  // Include subclass combat text profiles
  for (const classDef of Object.values(CLASS_DEFINITIONS)) {
    if (classDef.subclasses) {
      for (const sub of classDef.subclasses) {
        if (sub.combatTextProfile) {
          allProfiles.push(sub.combatTextProfile);
        }
      }
    }
  }

  return allProfiles;
}

// ----- Critical hit threshold -----

/**
 * Get the natural d20 value needed for a critical hit.
 * Standard is 20. Champion Fighter gets 19 (Improved Critical) or 18 (Superior Critical).
 */
export function getCriticalHitThreshold(classId: string, classLevel: number, subclassId?: string): number {
  if (classHasFeature(classId, SUPERIOR_CRITICAL, classLevel, subclassId)) return 18;
  if (classHasFeature(classId, IMPROVED_CRITICAL, classLevel, subclassId)) return 19;
  return 20;
}
