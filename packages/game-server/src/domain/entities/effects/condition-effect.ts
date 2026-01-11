import type { Creature } from "../creatures/creature.js";
import type { Condition } from "../combat/condition.js";
import { Effect } from "./effect.js";

export class ConditionEffect extends Effect {
  public readonly name = "Condition";
  public readonly condition: Condition;

  public constructor(condition: Condition) {
    super();
    this.condition = condition;
  }

  public apply(_target: Creature): void {
    // To be implemented by the rules engine / state layer.
  }
}
