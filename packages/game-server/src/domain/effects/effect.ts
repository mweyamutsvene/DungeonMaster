import type { Creature } from "../entities/creatures/creature.js";

export interface EffectResult {
  kind: string;
}

export abstract class Effect {
  public abstract readonly name: string;

  /**
   * Stage 2.3: Effects are deterministic mutations of domain entities.
   */
  public abstract apply(target: Creature): EffectResult;
}
