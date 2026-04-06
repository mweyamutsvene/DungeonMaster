/**
 * Monster Class
 * 
 * Represents an NPC or enemy creature in D&D 5e.
 * Extends Creature with monster-specific features like challenge rating.
 */

import { Creature, type CreatureData, proficiencyBonusFromCR } from "./creature.js";

export interface MonsterData extends CreatureData {
  challengeRating: number;
  experienceValue: number;
}

export class Monster extends Creature {
  private challengeRating: number;
  private experienceValue: number;

  constructor(data: MonsterData) {
    super(data);
    this.challengeRating = data.challengeRating;
    this.experienceValue = data.experienceValue;
  }

  // === Getters ===

  getChallengeRating(): number {
    return this.challengeRating;
  }

  getExperienceValue(): number {
    return this.experienceValue;
  }

  // === Proficiency Bonus ===

  getProficiencyBonus(): number {
    return proficiencyBonusFromCR(this.challengeRating);
  }

  // === Serialization ===

  toJSON() {
    return {
      ...super.toJSON(),
      challengeRating: this.challengeRating,
      experienceValue: this.experienceValue,
      proficiencyBonus: this.getProficiencyBonus(),
    };
  }
}
