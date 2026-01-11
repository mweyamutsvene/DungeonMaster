/**
 * Ability Scores
 *
 * Canonical, normalized implementation.
 */

export type Ability =
  | "strength"
  | "dexterity"
  | "constitution"
  | "intelligence"
  | "wisdom"
  | "charisma";

export interface AbilityScoresData {
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
}

export class AbilityScores {
  public constructor(private scores: AbilityScoresData) {}

  public getScore(ability: Ability): number {
    return this.scores[ability];
  }

  public getModifier(ability: Ability): number {
    return Math.floor((this.scores[ability] - 10) / 2);
  }

  public setScore(ability: Ability, score: number): void {
    if (!Number.isInteger(score) || score < 1) {
      throw new Error("Ability score cannot be less than 1");
    }
    this.scores[ability] = score;
  }

  public toJSON(): AbilityScoresData {
    return { ...this.scores };
  }
}
