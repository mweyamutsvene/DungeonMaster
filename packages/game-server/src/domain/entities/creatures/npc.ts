import { Creature, type CreatureData } from "./creature.js";

export interface NPCData extends CreatureData {
  role?: string;
  proficiencyBonus?: number;
}

export class NPC extends Creature {
  private role?: string;
  private proficiencyBonus: number;

  public constructor(data: NPCData) {
    super(data);
    this.role = data.role;
    this.proficiencyBonus = data.proficiencyBonus ?? 2;
  }

  public getRole(): string | undefined {
    return this.role;
  }

  public getProficiencyBonus(): number {
    return this.proficiencyBonus;
  }

  public toJSON() {
    return {
      ...super.toJSON(),
      role: this.role,
      proficiencyBonus: this.proficiencyBonus,
    };
  }
}
