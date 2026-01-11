import type { CharacterClassDefinition } from "./class-definition.js";

function assertValidLevel(level: number): void {
  if (!Number.isInteger(level) || level < 1 || level > 20) {
    throw new Error(`Invalid level: ${level}`);
  }
}

export function hasRangerFightingStyleAtLevel(level: number): boolean {
  assertValidLevel(level);
  return level >= 2;
}

export function hasRangerSpellcastingAtLevel(level: number): boolean {
  assertValidLevel(level);
  return level >= 2;
}

export function hasRangerSubclassAtLevel(level: number): boolean {
  assertValidLevel(level);
  return level >= 3;
}

export function hasRangerExtraAttackAtLevel(level: number): boolean {
  assertValidLevel(level);
  return level >= 5;
}

export const Ranger: CharacterClassDefinition = {
  id: "ranger",
  name: "Ranger",
  hitDie: 10,
  proficiencies: {
    savingThrows: ["strength", "dexterity"],
  },
};
