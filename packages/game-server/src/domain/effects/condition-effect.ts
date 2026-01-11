import type { Creature } from "../entities/creatures/creature.js";
import { Effect, type EffectResult } from "./effect.js";

export interface ConditionEffectData {
  condition: string;
}

export class ConditionEffect extends Effect {
  public readonly name = "Condition";
  private readonly condition: string;

  public constructor(data: ConditionEffectData) {
    super();
    const trimmed = data.condition.trim();
    if (trimmed.length === 0) {
      throw new Error("Condition must be non-empty");
    }
    this.condition = trimmed;
  }

  public apply(target: Creature): EffectResult {
    target.addCondition(this.condition);
    return { kind: "condition" };
  }

  public getCondition(): string {
    return this.condition;
  }
}
