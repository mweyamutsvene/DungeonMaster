import type { Ability } from "./ability-scores.js";

export type Skill =
  | "acrobatics"
  | "animalHandling"
  | "arcana"
  | "athletics"
  | "deception"
  | "history"
  | "insight"
  | "intimidation"
  | "investigation"
  | "medicine"
  | "nature"
  | "perception"
  | "performance"
  | "persuasion"
  | "religion"
  | "sleightOfHand"
  | "stealth"
  | "survival";

export const SKILL_TO_ABILITY: Readonly<Record<Skill, Ability>> = {
  acrobatics: "dexterity",
  animalHandling: "wisdom",
  arcana: "intelligence",
  athletics: "strength",
  deception: "charisma",
  history: "intelligence",
  insight: "wisdom",
  intimidation: "charisma",
  investigation: "intelligence",
  medicine: "wisdom",
  nature: "intelligence",
  perception: "wisdom",
  performance: "charisma",
  persuasion: "charisma",
  religion: "intelligence",
  sleightOfHand: "dexterity",
  stealth: "dexterity",
  survival: "wisdom",
} as const;

/** All valid Skill identifiers as an array for runtime validation. */
export const ALL_SKILLS: readonly Skill[] = Object.keys(SKILL_TO_ABILITY) as Skill[];

/** Check if a string is a valid Skill id. */
export function isSkill(value: string): value is Skill {
  return (ALL_SKILLS as readonly string[]).includes(value);
}

export function getGoverningAbility(skill: Skill): Ability {
  return SKILL_TO_ABILITY[skill];
}

/**
 * Compute the modifier for a single skill check.
 *
 * @param abilityScores — map of ability name → score (e.g. { strength: 16, dexterity: 14, … })
 * @param skill — the skill to compute
 * @param proficiencyBonus — character's proficiency bonus (2–6)
 * @param proficiencies — skills the character is proficient in
 * @param expertise — skills the character has expertise in (double proficiency)
 * @returns the total modifier for the skill check
 */
export function computeSkillModifier(
  abilityScores: Readonly<Record<string, number>>,
  skill: Skill,
  proficiencyBonus: number,
  proficiencies: readonly string[],
  expertise: readonly string[] = [],
): number {
  const ability = SKILL_TO_ABILITY[skill];
  const score = abilityScores[ability] ?? 10;
  const abilityMod = Math.floor((score - 10) / 2);

  if (expertise.includes(skill)) {
    return abilityMod + proficiencyBonus * 2;
  }
  if (proficiencies.includes(skill)) {
    return abilityMod + proficiencyBonus;
  }
  return abilityMod;
}
