/**
 * Fighting Style System
 *
 * In D&D 5e 2024, Fighting Styles are a category of feats. Martial classes
 * (Fighter at 1, Paladin at 2, Ranger at 2) gain one Fighting Style feat
 * for free as a class feature. Any character can also take them via the
 * Fighting Style feat category.
 *
 * This module defines the fighting style type and maps each style to its
 * corresponding feat ID, unifying the class-feature and feat-based paths.
 */

import {
  FEAT_ARCHERY,
  FEAT_DEFENSE,
  FEAT_DUELING,
  FEAT_GREAT_WEAPON_FIGHTING,
  FEAT_PROTECTION,
  FEAT_TWO_WEAPON_FIGHTING,
} from "../../rules/feat-modifiers.js";

/**
 * All recognized fighting style identifiers.
 * These correspond 1:1 to Fighting Style feats in D&D 5e 2024.
 */
export type FightingStyleId =
  | "archery"
  | "defense"
  | "dueling"
  | "great-weapon-fighting"
  | "protection"
  | "two-weapon-fighting";

export const ALL_FIGHTING_STYLE_IDS: readonly FightingStyleId[] = [
  "archery",
  "defense",
  "dueling",
  "great-weapon-fighting",
  "protection",
  "two-weapon-fighting",
] as const;

/**
 * Maps each fighting style to its equivalent feat ID.
 * This is the unification point: a class-granted fighting style and
 * the same feat acquired via Fighting Initiate produce identical effects.
 */
const FIGHTING_STYLE_TO_FEAT: Record<FightingStyleId, string> = {
  "archery": FEAT_ARCHERY,
  "defense": FEAT_DEFENSE,
  "dueling": FEAT_DUELING,
  "great-weapon-fighting": FEAT_GREAT_WEAPON_FIGHTING,
  "protection": FEAT_PROTECTION,
  "two-weapon-fighting": FEAT_TWO_WEAPON_FIGHTING,
};

/**
 * Get the feat ID corresponding to a fighting style.
 * Returns undefined if the id is not a valid fighting style.
 */
export function getFightingStyleFeatId(id: string): string | undefined {
  return FIGHTING_STYLE_TO_FEAT[id as FightingStyleId];
}

/**
 * Type guard for FightingStyleId.
 */
export function isFightingStyleId(value: string): value is FightingStyleId {
  return (ALL_FIGHTING_STYLE_IDS as readonly string[]).includes(value);
}
