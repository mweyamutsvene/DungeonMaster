import type { CharacterClassDefinition } from "./class-definition.js";

export const Ranger: CharacterClassDefinition = {
  id: "ranger",
  name: "Ranger",
  hitDie: 10,
  proficiencies: {
    savingThrows: ["strength", "dexterity"],
  },
  features: {
    "spellcasting": 2,
    "extra-attack": 5,
  },
};
