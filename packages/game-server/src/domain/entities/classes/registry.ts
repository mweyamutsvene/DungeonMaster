import type { CharacterClassDefinition, CharacterClassId } from "./class-definition.js";
import type { ClassCombatTextProfile } from "./combat-text-profile.js";

import { Barbarian, BARBARIAN_COMBAT_TEXT_PROFILE } from "./barbarian.js";
import { Bard } from "./bard.js";
import { Cleric, CLERIC_COMBAT_TEXT_PROFILE } from "./cleric.js";
import { Druid } from "./druid.js";
import { Fighter, FIGHTER_COMBAT_TEXT_PROFILE } from "./fighter.js";
import { Monk, MONK_COMBAT_TEXT_PROFILE } from "./monk.js";
import { Paladin, PALADIN_COMBAT_TEXT_PROFILE } from "./paladin.js";
import { Ranger } from "./ranger.js";
import { Rogue } from "./rogue.js";
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
];

/** Get all registered combat text profiles. */
export function getAllCombatTextProfiles(): readonly ClassCombatTextProfile[] {
  return COMBAT_TEXT_PROFILES;
}
