import type { ActionContext, GameEvent } from "./action.js";
import { Action } from "./action.js";

export class AttackAction extends Action {
  public readonly name = "Attack";

  public execute(_ctx: ActionContext): ReadonlyArray<GameEvent> {
    return [{ type: "Log", message: "AttackAction not implemented" }];
  }
}
