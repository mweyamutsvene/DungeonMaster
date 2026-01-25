/**
 * Session Tactical Routes
 *
 * Handles tactical combat view and LLM-powered combat queries.
 *
 * Endpoints:
 * - GET /sessions/:id/combat/:encounterId/tactical - Get tactical combat view
 * - POST /sessions/:id/combat/query - LLM-powered tactical Q&A
 */

import type { FastifyInstance } from "fastify";
import type { SessionRouteDeps } from "./types.js";
import { ValidationError } from "../../../../application/errors.js";

export function registerSessionTacticalRoutes(app: FastifyInstance, deps: SessionRouteDeps): void {
  /**
   * GET /sessions/:id/combat/:encounterId/tactical
   * Get a rich tactical view of the combat including positions, distances, and action economy.
   */
  app.get<{
    Params: { id: string; encounterId: string };
  }>("/sessions/:id/combat/:encounterId/tactical", async (req) => {
    const sessionId = req.params.id;
    const encounterId = req.params.encounterId;

    return deps.tacticalView.getTacticalView(sessionId, encounterId);
  });

  /**
   * POST /sessions/:id/combat/query
   * Ask the LLM tactical questions about combat (distances, opportunity attacks, etc.).
   */
  app.post<{
    Params: { id: string };
    Body: { query: unknown; actorId: unknown; encounterId: unknown; seed?: unknown };
  }>("/sessions/:id/combat/query", async (req) => {
    if (!deps.intentParser) {
      throw new ValidationError("LLM intent parser is not configured");
    }

    const sessionId = req.params.id;
    const queryRaw = req.body?.query;
    const actorIdRaw = req.body?.actorId;
    const encounterIdRaw = req.body?.encounterId;

    if (typeof queryRaw !== "string" || queryRaw.trim().length === 0) {
      throw new ValidationError("query is required");
    }
    if (typeof actorIdRaw !== "string" || actorIdRaw.trim().length === 0) {
      throw new ValidationError("actorId is required");
    }
    if (typeof encounterIdRaw !== "string" || encounterIdRaw.trim().length === 0) {
      throw new ValidationError("encounterId is required");
    }

    const seedRaw = req.body?.seed;
    const seed = typeof seedRaw === "number" ? seedRaw : undefined;
    if (seedRaw !== undefined && seed === undefined) {
      throw new ValidationError("seed must be a number");
    }

    const query = queryRaw.trim();
    const actorCharacterId = actorIdRaw.trim();
    const encounterId = encounterIdRaw.trim();

    // Build context for LLM
    const context = await deps.tacticalView.buildCombatQueryContext(
      sessionId,
      encounterId,
      actorCharacterId,
      query,
    );

    // Build schema hint for LLM response
    const schemaHint = [
      "Return a single JSON object with this shape:",
      '{\n  "answer": string\n}',
      "Rules:",
      "- Be concise and tactical.",
      "- Use only numbers provided in the context JSON.",
      "- If asked about attacks/actions/features, use actor.attackOptions and actor.capabilities; do not invent new ones.",
      "- If the question asks for something missing (e.g. unknown destination), say what input is needed.",
    ].join("\n");

    const llmText = [
      "You are answering a player's tactical question about a D&D combat encounter.",
      "Context JSON (authoritative numbers):",
      JSON.stringify(context, null, 2),
      "",
      "Question:",
      query,
    ].join("\n");

    const llm = await deps.intentParser.parseIntent({ text: llmText, seed, schemaHint });
    const answer = typeof (llm as any)?.answer === "string" ? (llm as any).answer : "I couldn't generate an answer.";

    return {
      answer,
      context: {
        distances: context.distances.map((d) => ({
          targetId: d.targetId,
          distance: d.distance,
        })),
        oaPrediction: {
          destination: context.oaPrediction.destination,
          movementRequiredFeet: context.oaPrediction.movementRequiredFeet,
          movementRemainingFeet: context.actor.movementRemainingFeet,
          oaRisks: context.oaPrediction.oaRisks
            .filter((r) => r.wouldProvoke)
            .map((r) => ({
              combatantId: r.combatantId,
              combatantName: r.combatantName,
              reach: r.reach,
              hasReaction: r.hasReaction,
            })),
        },
      },
    };
  });
}
