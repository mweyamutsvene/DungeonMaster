import type { ActionContext, GameEvent } from "./action.js";
import { Action } from "./action.js";

export class SpellcastAction extends Action {
  public readonly name = "Spellcast";

  public execute(_ctx: ActionContext): ReadonlyArray<GameEvent> {
    return [{ type: "Log", message: "SpellcastAction not implemented" }];
  }
}
