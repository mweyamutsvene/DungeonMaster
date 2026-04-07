import type { Creature } from "../entities/creatures/creature.js";
import { Effect, type EffectResult } from "./effect.js";
import { applyDamageDefenses } from "../rules/damage-defenses.js";

export interface DamageEffectData {
  amount: number;
  damageType?: string;
}

export interface DamageEffectResult extends EffectResult {
  kind: "damage";
  applied: number;
  defenseApplied?: "resistance" | "vulnerability" | "immunity" | "none";
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

  public apply(target: Creature): DamageEffectResult {
    let applied = this.amount;
    let defenseApplied: DamageEffectResult["defenseApplied"];

    // Route through damage defense system when damage type is specified
    if (this.amount > 0 && this.damageType) {
      const defenses = target.getDamageDefenses();
      const result = applyDamageDefenses(this.amount, this.damageType, defenses);
      applied = result.adjustedDamage;
      defenseApplied = result.defenseApplied;
    }

    target.takeDamage(applied);
    return { kind: "damage", applied, defenseApplied };
  }

  public getAmount(): number {
    return this.amount;
  }

  public getDamageType(): string | undefined {
    return this.damageType;
  }
}
