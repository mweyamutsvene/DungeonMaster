import type { Creature } from "../creatures/creature.js";

export abstract class Effect {
  public abstract readonly name: string;
  public abstract apply(target: Creature): void;
}
