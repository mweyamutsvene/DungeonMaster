import type { ActionContext, GameEvent } from "./action.js";
import { Action } from "./action.js";

export class SkillCheckAction extends Action {
  public readonly name = "SkillCheck";

  public execute(_ctx: ActionContext): ReadonlyArray<GameEvent> {
    return [{ type: "Log", message: "SkillCheckAction not implemented" }];
  }
}
