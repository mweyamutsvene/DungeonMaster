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

/** A combat capability a class grants at a given level (for tactical context display). */
export interface ClassCapability {
  name: string;
  economy: "action" | "bonusAction" | "reaction" | "free";
  cost?: string;
  requires?: string;
  effect: string;

  /** Stable ability ID for executor/registry lookups (e.g. "class:monk:flurry-of-blows"). */
  abilityId?: string;
  /** Structured resource cost for automated spending (e.g. { pool: "ki", amount: 1 }). */
  resourceCost?: { pool: string; amount: number };
  /** Execution intent hint for data-driven ability resolution. Consumer narrows on `kind`. */
  executionIntent?: {
    kind: string;
    [key: string]: unknown;
  };
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

  /**
   * Combat capabilities available at a given level (for tactical context / UI display).
   * Optional — classes without special abilities don't need this.
   */
  capabilitiesForLevel?: (level: number) => readonly ClassCapability[];
}
