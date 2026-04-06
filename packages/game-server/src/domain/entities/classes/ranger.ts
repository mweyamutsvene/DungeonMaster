import type { CharacterClassDefinition, ClassCapability } from "./class-definition.js";
import type { ClassCombatTextProfile } from "./combat-text-profile.js";

export const Ranger: CharacterClassDefinition = {
  id: "ranger",
  name: "Ranger",
  hitDie: 10,
  proficiencies: {
    savingThrows: ["strength", "dexterity"],
  },
  features: {
    "weapon-mastery": 1,
    "favored-enemy": 1,
    "fighting-style": 2,
    "spellcasting": 2,
    "extra-attack": 5,
  },
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
  actionMappings: [
    {
      keyword: "hunters-mark",
      normalizedPatterns: [/huntersmark|casthuntersmark/],
      abilityId: "class:ranger:hunters-mark",
      category: "bonusAction",
    },
  ],
  attackEnhancements: [],
};
