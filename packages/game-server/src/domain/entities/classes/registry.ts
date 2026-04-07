import type { CharacterClassDefinition, CharacterClassId, SubclassDefinition } from "./class-definition.js";
import { isCharacterClassId } from "./class-definition.js";
import type { ClassCombatTextProfile } from "./combat-text-profile.js";
import { IMPROVED_CRITICAL, SUPERIOR_CRITICAL } from "./feature-keys.js";

import { Barbarian, BARBARIAN_COMBAT_TEXT_PROFILE } from "./barbarian.js";
import { Bard, BARD_COMBAT_TEXT_PROFILE } from "./bard.js";
import { Cleric, CLERIC_COMBAT_TEXT_PROFILE } from "./cleric.js";
import { Druid, DRUID_COMBAT_TEXT_PROFILE } from "./druid.js";
import { Fighter, FIGHTER_COMBAT_TEXT_PROFILE } from "./fighter.js";
import { Monk, MONK_COMBAT_TEXT_PROFILE } from "./monk.js";
import { Paladin, PALADIN_COMBAT_TEXT_PROFILE } from "./paladin.js";
import { Ranger, RANGER_COMBAT_TEXT_PROFILE } from "./ranger.js";
import { Rogue, ROGUE_COMBAT_TEXT_PROFILE } from "./rogue.js";
import { Sorcerer, SORCERER_COMBAT_TEXT_PROFILE } from "./sorcerer.js";
import { Warlock, WARLOCK_COMBAT_TEXT_PROFILE } from "./warlock.js";
import { Wizard, WIZARD_COMBAT_TEXT_PROFILE } from "./wizard.js";

// Lazy-init to avoid circular-dependency TDZ issues: class domain files
// (monk.ts, rogue.ts, …) may import classHasFeature from this module while
// this module imports their class definitions.  Deferring the object creation
// to the first call guarantees all class exports have been fully evaluated.
let _classDefs: Record<CharacterClassId, CharacterClassDefinition> | null = null;

function classDefs(): Record<CharacterClassId, CharacterClassDefinition> {
  if (!_classDefs) {
    _classDefs = {
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
  }
  return _classDefs;
}

import type { ArmorTraining } from "../items/equipped-items.js";

export function getClassDefinition(classId: CharacterClassId): CharacterClassDefinition {
  return classDefs()[classId];
}

/**
 * Derive ArmorTraining flags from a class's armor proficiency list.
 * Returns full training (all true) for unknown class IDs to preserve backward compatibility.
 */
export function getArmorTrainingForClass(classId: string): ArmorTraining {
  const normalized = classId.toLowerCase();
  if (!isCharacterClassId(normalized)) {
    return { light: true, medium: true, heavy: true, shield: true };
  }
  const def = classDefs()[normalized];
  const armorList = def.proficiencies.armor ?? [];
  return {
    light: armorList.includes("light"),
    medium: armorList.includes("medium"),
    heavy: armorList.includes("heavy"),
    shield: armorList.includes("shield"),
  };
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
  const def = classDefs()[normalized];
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
  const def = classDefs()[normalized];

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
  return classDefs()[normalized].features?.[feature];
}

// ----- Combat text profile registry -----

/**
 * All registered class combat text profiles.
 * When adding a new class with combat abilities, add its profile here.
 */
let _textProfiles: readonly ClassCombatTextProfile[] | null = null;

function combatTextProfiles(): readonly ClassCombatTextProfile[] {
  if (!_textProfiles) {
    _textProfiles = [
      MONK_COMBAT_TEXT_PROFILE,
      FIGHTER_COMBAT_TEXT_PROFILE,
      WIZARD_COMBAT_TEXT_PROFILE,
      WARLOCK_COMBAT_TEXT_PROFILE,
      BARBARIAN_COMBAT_TEXT_PROFILE,
      PALADIN_COMBAT_TEXT_PROFILE,
      CLERIC_COMBAT_TEXT_PROFILE,
      ROGUE_COMBAT_TEXT_PROFILE,
      RANGER_COMBAT_TEXT_PROFILE,
      BARD_COMBAT_TEXT_PROFILE,
      SORCERER_COMBAT_TEXT_PROFILE,
      DRUID_COMBAT_TEXT_PROFILE,
    ];
  }
  return _textProfiles;
}

/** Get all registered combat text profiles (class + subclass). */
export function getAllCombatTextProfiles(): readonly ClassCombatTextProfile[] {
  const allProfiles: ClassCombatTextProfile[] = [...combatTextProfiles()];

  // Include subclass combat text profiles
  for (const classDef of Object.values(classDefs())) {
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
