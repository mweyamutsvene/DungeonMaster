import type { Ability } from "../core/ability-scores.js";
import type { Skill } from "../core/skills.js";
import type { ResourcePool } from "../combat/resource-pool.js";

export type CharacterClassId =
  | "barbarian"
  | "bard"
  | "cleric"
  | "druid"
  | "fighter"
  | "monk"
  | "paladin"
  | "ranger"
  | "rogue"
  | "sorcerer"
  | "warlock"
  | "wizard";

export const CHARACTER_CLASS_IDS: readonly CharacterClassId[] = [
  "barbarian",
  "bard",
  "cleric",
  "druid",
  "fighter",
  "monk",
  "paladin",
  "ranger",
  "rogue",
  "sorcerer",
  "warlock",
  "wizard",
] as const;

export function isCharacterClassId(value: string): value is CharacterClassId {
  return (CHARACTER_CLASS_IDS as readonly string[]).includes(value);
}

export type HitDie = 6 | 8 | 10 | 12;

export interface ClassSkillChoices {
  choose: number;
  from: readonly Skill[];
}

export interface ClassProficiencies {
  savingThrows: readonly Ability[];
  skills?: ClassSkillChoices;

  // String-based for now; later stages can normalize to enum IDs.
  armor?: readonly string[];
  weapons?: readonly string[];
  tools?: readonly string[];
}

export interface CharacterClassDefinition {
  id: CharacterClassId;
  name: string;
  hitDie: HitDie;
  proficiencies: ClassProficiencies;

  /**
   * Class-owned resources that should exist for a character at a given level.
   * Kept explicit and deterministic.
   */
  resourcesAtLevel?: (level: number) => readonly ResourcePool[];
}
