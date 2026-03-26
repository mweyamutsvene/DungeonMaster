import type { CharacterClassDefinition } from "./class-definition.js";

export const Ranger: CharacterClassDefinition = {
  id: "ranger",
  name: "Ranger",
  hitDie: 10,
  proficiencies: {
    savingThrows: ["strength", "dexterity"],
  },
  features: {
    "weapon-mastery": 1,
    "fighting-style": 2,
    "spellcasting": 2,
    "extra-attack": 5,
  },
};
