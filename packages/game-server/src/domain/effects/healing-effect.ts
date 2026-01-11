import type { Creature } from "../entities/creatures/creature.js";
import { Effect, type EffectResult } from "./effect.js";

export interface HealingEffectData {
  amount: number;
}

export class HealingEffect extends Effect {
  public readonly name = "Healing";
  private readonly amount: number;

  public constructor(data: HealingEffectData) {
    super();
    if (!Number.isInteger(data.amount) || data.amount < 0) {
      throw new Error("Healing amount must be an integer >= 0");
    }
    this.amount = data.amount;
  }

  public apply(target: Creature): EffectResult {
    target.heal(this.amount);
    return { kind: "healing" };
  }

  public getAmount(): number {
    return this.amount;
  }
}
