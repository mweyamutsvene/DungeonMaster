import type { Creature } from "../entities/creatures/creature.js";
import { Effect, type EffectResult } from "./effect.js";

export interface DamageEffectData {
  amount: number;
  damageType?: string;
}

export class DamageEffect extends Effect {
  public readonly name = "Damage";
  private readonly amount: number;
  private readonly damageType?: string;

  public constructor(data: DamageEffectData) {
    super();
    if (!Number.isInteger(data.amount) || data.amount < 0) {
      throw new Error("Damage amount must be an integer >= 0");
    }
    this.amount = data.amount;
    this.damageType = data.damageType;
  }

  public apply(target: Creature): EffectResult {
    target.takeDamage(this.amount);
    return { kind: "damage" };
  }

  public getAmount(): number {
    return this.amount;
  }

  public getDamageType(): string | undefined {
    return this.damageType;
  }
}
