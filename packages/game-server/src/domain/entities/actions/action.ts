import type { Creature } from "../creatures/creature.js";

export interface ActionContext {
  actor: Creature;
  targets: ReadonlyArray<Creature>;
}

export type GameEvent =
  | { type: "Log"; message: string }
  | { type: "Damage"; sourceId: string; targetId: string; amount: number }
  | { type: "Heal"; sourceId: string; targetId: string; amount: number }
  | { type: "ConditionApplied"; sourceId: string; targetId: string; condition: string };

export abstract class Action {
  public abstract readonly name: string;

  public abstract execute(ctx: ActionContext): ReadonlyArray<GameEvent>;
}
