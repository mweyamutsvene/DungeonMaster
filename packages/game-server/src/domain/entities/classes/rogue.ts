import type { CharacterClassDefinition } from "./class-definition.js";

export function sneakAttackDiceForLevel(level: number): number {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error(`Invalid level: ${level}`);
  }

  // Sneak Attack starts at 1d6 and increases by 1d6 at odd levels.
  // 1:1, 3:2, 5:3, ... 19:10
  return Math.floor((level + 1) / 2);
}

export const Rogue: CharacterClassDefinition = {
  id: "rogue",
  name: "Rogue",
  hitDie: 8,
  proficiencies: {
    savingThrows: ["dexterity", "intelligence"],
  },
};
