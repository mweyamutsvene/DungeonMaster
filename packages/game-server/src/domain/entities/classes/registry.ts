import type { CharacterClassDefinition, CharacterClassId } from "./class-definition.js";

import { Barbarian } from "./barbarian.js";
import { Bard } from "./bard.js";
import { Cleric } from "./cleric.js";
import { Druid } from "./druid.js";
import { Fighter } from "./fighter.js";
import { Monk } from "./monk.js";
import { Paladin } from "./paladin.js";
import { Ranger } from "./ranger.js";
import { Rogue } from "./rogue.js";
import { Sorcerer } from "./sorcerer.js";
import { Warlock } from "./warlock.js";
import { Wizard } from "./wizard.js";

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
