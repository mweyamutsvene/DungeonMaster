import type { Skill } from "../core/skills.js";

export type AbilityScore =
  | "strength"
  | "dexterity"
  | "constitution"
  | "intelligence"
  | "wisdom"
  | "charisma";

export interface StartingEquipmentItem {
  name: string;
  quantity: number;
}

export interface BackgroundDefinition {
  id: string;
  name: string;
  abilityScoreOptions: readonly [AbilityScore, AbilityScore, AbilityScore];
  skillProficiencies: readonly [Skill, Skill];
  toolProficiency: string;
  language: "any" | string;
  originFeat: string;
  startingEquipment: readonly StartingEquipmentItem[];
}

export type BackgroundAsiChoice = Partial<Record<AbilityScore, number>>;
