import type { Creature } from "../creatures/creature.js";
import { Effect } from "./effect.js";

export class HealingEffect extends Effect {
  public readonly name = "Healing";
  public readonly amount: number;

  public constructor(amount: number) {
    super();
    this.amount = amount;
  }

  public apply(_target: Creature): void {
    // To be implemented by the rules engine / state layer.
  }
}
