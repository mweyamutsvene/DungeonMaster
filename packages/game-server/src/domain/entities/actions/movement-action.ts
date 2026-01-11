import type { ActionContext, GameEvent } from "./action.js";
import { Action } from "./action.js";

export class MovementAction extends Action {
  public readonly name = "Movement";

  public execute(_ctx: ActionContext): ReadonlyArray<GameEvent> {
    return [{ type: "Log", message: "MovementAction not implemented" }];
  }
}
