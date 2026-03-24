/**
 * AiActionRegistry — central registry for AI action handler strategies.
 *
 * Mirrors `AbilityRegistry` from the ClassAbilities flow.
 * Handlers are registered at startup; `execute()` performs a linear scan
 * via `handles()` and delegates to the first matching handler.
 *
 * Layer: Application
 */

import type { AiActionHandler, AiActionHandlerContext, AiActionHandlerDeps, AiHandlerResult } from "./ai-action-handler.js";

export class AiActionRegistry {
  private handlers: AiActionHandler[] = [];

  /**
   * Register an action handler.
   * Handlers are checked in registration order — register more-specific handlers first.
   */
  register(handler: AiActionHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Find the first handler that can execute the given action.
   *
   * @param action - Action string from `AiDecision.action`
   * @returns Handler if found, undefined otherwise
   */
  findHandler(action: string): AiActionHandler | undefined {
    return this.handlers.find((h) => h.handles(action));
  }

  /**
   * Execute the action described by `ctx.decision.action`.
   * Returns an `ok: false` result if no handler is registered.
   */
  async execute(ctx: AiActionHandlerContext, deps: AiActionHandlerDeps): Promise<AiHandlerResult> {
    const handler = this.findHandler(ctx.decision.action);

    if (!handler) {
      return {
        action: ctx.decision.action,
        ok: false,
        summary: `Action ${ctx.decision.action} not recognized. Use 'attack', 'move', 'dodge', 'dash', 'disengage', 'help', 'shove', 'grapple', 'hide', 'search', 'castSpell', or 'endTurn'.`,
        data: { reason: "unknown_action" },
      };
    }

    return handler.execute(ctx, deps);
  }

  /**
   * Check if a handler is registered for the given action.
   */
  hasHandler(action: string): boolean {
    return this.findHandler(action) !== undefined;
  }

  /**
   * Get all registered handlers (for testing/debugging).
   */
  getHandlers(): ReadonlyArray<AiActionHandler> {
    return this.handlers;
  }

  /**
   * Clear all registered handlers (for testing).
   */
  clear(): void {
    this.handlers = [];
  }
}
