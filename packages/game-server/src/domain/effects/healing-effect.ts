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
    // NOTE: Per D&D 5e 2024, healing from 0 HP resets death saves.
    // Death saves are tracked at the combat/application layer (combatant resources),
    // not on the Creature entity. Callers (e.g. HealingSpellDeliveryHandler,
    // RollStateMachine, ko-handler) are responsible for resetting death saves
    // when healing revives a creature from 0 HP.
    target.heal(this.amount);
    return { kind: "healing" };
  }

  public getAmount(): number {
    return this.amount;
  }
}
