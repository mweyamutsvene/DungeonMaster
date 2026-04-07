import type { Ability } from "../core/ability-scores.js";
import type { Skill } from "../core/skills.js";
import type { ResourcePool } from "../combat/resource-pool.js";
import type { ClassCombatTextProfile } from "./combat-text-profile.js";

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

/**
 * Entry in a class's rest-refresh policy. Declares how a resource pool resets on short/long rest.
 * - `refreshOn: "short"` — only short rest
 * - `refreshOn: "long"` — only long rest
 * - `refreshOn: "both"` — short or long rest
 * - `refreshOn: function` — custom predicate (e.g. level-dependent logic like Bard's bardic inspiration)
 * - `computeMax` — optional function to recompute the pool's max on refresh. If absent, the stored max is kept.
 *   `abilityModifiers` is a map of ability names to their MODIFIERS (not scores), for classes like Bard that
 *   derive pool size from the charisma modifier.
 */
export interface RestRefreshPolicyEntry {
  poolKey: string;
  refreshOn: "short" | "long" | "both" | ((rest: "short" | "long", level: number) => boolean);
  computeMax?: (level: number, abilityModifiers?: Record<string, number>) => number;
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
  /** Subclass ID required for this capability (e.g. "berserker", "open-hand"). */
  requiresSubclass?: string;
}

export interface CharacterClassDefinition {
  id: CharacterClassId;
  name: string;
  hitDie: HitDie;
  proficiencies: ClassProficiencies;

  /**
   * Feature availability map: featureId → minimum class level required.
   * Used for fast boolean gate checks (e.g. "does this class get Extra Attack at level 5?").
   * Feature keys are open strings to support homebrew/unique classes.
   * Use constants from `feature-keys.ts` for standard features.
   */
  features?: Record<string, number>;

  /**
   * Class-owned resources that should exist for a character at a given level.
   * Kept explicit and deterministic.
   * `abilityModifiers` is a map of ability names to their MODIFIERS (not scores),
   * for classes whose resource pools depend on ability scores (e.g. Monk's
   * Wholeness of Body uses = WIS modifier). Matches `resourcePoolFactory` convention.
   */
  resourcesAtLevel?: (level: number, abilityModifiers?: Record<string, number>) => readonly ResourcePool[];

  /**
   * Factory that builds the default resource pools for character initialization and leveling.
   * `abilityModifiers` is a map of ability names to their MODIFIERS (not scores).
   * Currently only `charisma` is used (by Bard's bardic inspiration).
   * Optional — classes without resources omit this field.
   */
  resourcePoolFactory?: (level: number, abilityModifiers?: Record<string, number>) => readonly ResourcePool[];

  /**
   * Declares how each class resource pool refreshes on short/long rest.
   * Used by `refreshClassResourcePools` in `rest.ts` to replace the switch-statement hub.
   * Optional — classes without resources omit this field.
   */
  restRefreshPolicy?: readonly RestRefreshPolicyEntry[];

  /**
   * Combat capabilities available at a given level (for tactical context / UI display).
   * Optional — classes without special abilities don't need this.
   */
  capabilitiesForLevel?: (level: number) => readonly ClassCapability[];

  /**
   * Subclass definitions available for this class.
   * Each subclass has its own features map (same pattern as class features).
   * Optional — classes without implemented subclasses omit this field.
   */
  subclasses?: readonly SubclassDefinition[];
}

/**
 * Subclass definition — a specialization within a character class.
 * Features map works the same as class features: featureId → minimum class level.
 * Optional combatTextProfile adds subclass-specific text parsing.
 */
export interface SubclassDefinition {
  /** Kebab-case identifier (e.g. "champion", "open-hand", "berserker"). */
  id: string;
  /** Display name (e.g. "Champion", "Way of the Open Hand"). */
  name: string;
  /** Parent class ID. */
  classId: CharacterClassId;
  /** Feature availability map: featureId → minimum class level required. */
  features: Record<string, number>;
  /** Optional combat text profile for subclass-specific ability parsing. */
  combatTextProfile?: ClassCombatTextProfile;
}
