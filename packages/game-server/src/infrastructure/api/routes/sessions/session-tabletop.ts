/**
 * Session Tabletop Routes
 *
 * Handles tabletop-style combat with manual dice rolling.
 *
 * Endpoints:
 * - POST /sessions/:id/combat/initiate - Initiate combat action, request initiative roll
 * - POST /sessions/:id/combat/roll-result - Process dice roll result
 * - POST /sessions/:id/combat/action - Parse combat action (move, attack, bonus action)
 * - POST /sessions/:id/combat/move/complete - Complete move after reaction resolution
 */

import type { FastifyInstance } from "fastify";
import type { SessionRouteDeps } from "./types.js";
import { createDebugLogger } from "./types.js";
import { ValidationError } from "../../../../application/errors.js";

export function registerSessionTabletopRoutes(app: FastifyInstance, deps: SessionRouteDeps): void {
  const debug = createDebugLogger();

  /**
   * POST /sessions/:id/combat/initiate
   * Start a tabletop combat flow by parsing intent and requesting initiative roll.
   */
  app.post<{
    Params: { id: string };
    Body: { text: string; actorId: string };
  }>("/sessions/:id/combat/initiate", async (req) => {
    if (!deps.intentParser) {
      throw new ValidationError("LLM intent parser is not configured");
    }

    const sessionId = req.params.id;
    const { text, actorId } = req.body;

    if (!text || typeof text !== "string") {
      throw new ValidationError("text is required");
    }
    if (!actorId || typeof actorId !== "string") {
      throw new ValidationError("actorId is required");
    }

    return deps.tabletopCombat.initiateAction(sessionId, text, actorId);
  });

  /**
   * POST /sessions/:id/combat/roll-result
   * Process a dice roll result (initiative, attack, or damage).
   */
  app.post<{
    Params: { id: string };
    Body: { text: string; actorId: string };
  }>("/sessions/:id/combat/roll-result", async (req) => {
    try {
      debug.log("=== ROLL RESULT START ===");
      if (debug.enabled) {
        req.log.info({ text: req.body.text, actorId: req.body.actorId }, "Roll result endpoint start");
      }

      const sessionId = req.params.id;
      const { text, actorId } = req.body;

      if (!text || typeof text !== "string") {
        throw new ValidationError("text is required");
      }
      if (!actorId || typeof actorId !== "string") {
        throw new ValidationError("actorId is required");
      }

      return deps.tabletopCombat.processRollResult(sessionId, text, actorId);
    } catch (err) {
      console.error("Roll result endpoint error:", err);
      console.error("Stack:", (err as Error).stack);
      req.log.error({ err, stack: (err as Error).stack }, "Roll result endpoint error");
      throw err;
    }
  });

  /**
   * POST /sessions/:id/combat/action
   * Parse and execute a combat action (move, attack, bonus action).
   */
  app.post<{
    Params: { id: string };
    Body: { text: string; actorId: string; encounterId: string };
  }>("/sessions/:id/combat/action", async (req) => {
    const sessionId = req.params.id;
    const { text, actorId, encounterId } = req.body;

    if (!text || typeof text !== "string") {
      throw new ValidationError("text is required");
    }
    if (!actorId || typeof actorId !== "string") {
      throw new ValidationError("actorId is required");
    }
    if (!encounterId || typeof encounterId !== "string") {
      throw new ValidationError("encounterId is required");
    }

    return deps.tabletopCombat.parseCombatAction(sessionId, text, actorId, encounterId);
  });

  /**
   * POST /sessions/:id/combat/move/complete
   * Complete a move after reaction resolution (opportunity attacks).
   */
  app.post<{
    Params: { id: string };
    Body: { pendingActionId: string };
  }>("/sessions/:id/combat/move/complete", async (req) => {
    const sessionId = req.params.id;
    await deps.sessions.getSessionOrThrow(sessionId);

    const pendingActionId = req.body?.pendingActionId;
    if (!pendingActionId || typeof pendingActionId !== "string") {
      throw new ValidationError("pendingActionId is required");
    }

    return deps.tabletopCombat.completeMove(sessionId, pendingActionId);
  });
}
