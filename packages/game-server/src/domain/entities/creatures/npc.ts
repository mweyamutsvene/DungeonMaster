import { Creature, type CreatureData, proficiencyBonusFromCR } from "./creature.js";

export interface NPCData extends CreatureData {
  role?: string;
  proficiencyBonus?: number;
  challengeRating?: number;
  level?: number;
  classId?: string;
  subclass?: string;
  featIds?: readonly string[];
}

export class NPC extends Creature {
  private role?: string;
  private proficiencyBonus: number;
  private level: number;
  private classId?: string;
  private subclass?: string;
  private featIds: string[];

  public constructor(data: NPCData) {
    super(data);
    this.role = data.role;
    this.proficiencyBonus = data.proficiencyBonus
      ?? (data.challengeRating != null ? proficiencyBonusFromCR(data.challengeRating) : 2);
    this.level = data.level ?? 0;
    this.classId = data.classId;
    this.subclass = data.subclass;
    this.featIds = data.featIds ? [...data.featIds] : [];
  }

  public getRole(): string | undefined {
    return this.role;
  }

  public getProficiencyBonus(): number {
    return this.proficiencyBonus;
  }

  public getFeatIds(): readonly string[] {
    return [...this.featIds];
  }

  public getClassId(): string | undefined {
    return this.classId;
  }

  public getSubclass(): string | undefined {
    return this.subclass;
  }

  public getLevel(): number {
    return this.level;
  }

  public toJSON() {
    return {
      ...super.toJSON(),
      role: this.role,
      proficiencyBonus: this.proficiencyBonus,
      level: this.level,
      classId: this.classId,
      subclass: this.subclass,
      featIds: [...this.featIds],
    };
  }
}
