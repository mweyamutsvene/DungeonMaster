import type { ResourcePool } from "../combat/resource-pool.js";
import type { CharacterClassDefinition, ClassCapability } from "./class-definition.js";
import type { ClassCombatTextProfile } from "./combat-text-profile.js";
import { FAVORED_ENEMY } from "./feature-keys.js";
import { getSpellSlots } from "../spells/spell-progression.js";

/**
 * Build Ranger spell slot resource pools for a given level.
 * Rangers are half-casters, gaining spell slots starting at level 2.
 */
function getRangerSpellSlotPools(level: number): ResourcePool[] {
  const slots = getSpellSlots("ranger", level);
  return Object.entries(slots)
    .filter(([, count]) => count > 0)
    .map(([slotLevel, count]) => ({ name: `spellSlot_${slotLevel}`, current: count, max: count }));
}

export const Ranger: CharacterClassDefinition = {
  id: "ranger",
  name: "Ranger",
  hitDie: 10,
  proficiencies: {
    savingThrows: ["strength", "dexterity"],
  },
  features: {
    "weapon-mastery": 1,
    [FAVORED_ENEMY]: 1,
    "fighting-style": 2,
    "spellcasting": 2,
    "extra-attack": 5,
  },
  resourcesAtLevel: (level) => getRangerSpellSlotPools(level),
  resourcePoolFactory: (level) => getRangerSpellSlotPools(level),
  restRefreshPolicy: [],  // Spell slots refreshed generically in rest.ts via spellSlot_* prefix
  capabilitiesForLevel: (level): readonly ClassCapability[] => {
    const caps: ClassCapability[] = [];
    caps.push({ name: "Favored Enemy", economy: "free", effect: "Advantage on tracking and knowledge about favored enemies" });
    if (level >= 1) {
      caps.push({ name: "Weapon Mastery", economy: "free", effect: "Use weapon mastery properties" });
    }
    if (level >= 2) {
      caps.push({ name: "Fighting Style", economy: "free", effect: "Chosen fighting style bonus" });
      caps.push({ name: "Spellcasting", economy: "action", effect: "Cast ranger spells using WIS" });
    }
    if (level >= 5) {
      caps.push({ name: "Extra Attack", economy: "action", requires: "Attack action", effect: "Attack twice per Attack action" });
    }
    return caps;
  },
};

// ----- Combat Text Profile -----

export const RANGER_COMBAT_TEXT_PROFILE: ClassCombatTextProfile = {
  classId: "ranger",
  actionMappings: [],
  attackEnhancements: [],
};
