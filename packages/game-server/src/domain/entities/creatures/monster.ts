/**
 * Monster Class
 * 
 * Represents an NPC or enemy creature in D&D 5e.
 * Extends Creature with monster-specific features like challenge rating.
 */

import { Creature, type CreatureData } from "./creature.js";

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
    // D&D 5e monster proficiency bonus by CR
    const cr = this.challengeRating;
    if (cr <= 0.25) return 2;
    if (cr <= 4) return 2;
    if (cr <= 8) return 3;
    if (cr <= 12) return 4;
    if (cr <= 16) return 5;
    if (cr <= 20) return 6;
    if (cr <= 24) return 7;
    if (cr <= 28) return 8;
    return 9;
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
