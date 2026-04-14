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
import { NotFoundError, ValidationError } from "../../../../application/errors.js";
import { findPath, findAdjacentPosition } from "../../../../domain/rules/pathfinding.js";
import type { CombatMap } from "../../../../domain/rules/combat-map.js";
import type { Position } from "../../../../domain/rules/movement.js";

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
      "- ONLY use information present in the context JSON below. Do NOT invent, assume, or hallucinate features, abilities, attacks, or numbers that are not explicitly listed.",
      "- If asked about attacks/actions/features, check actor.capabilities.classFeatures and actor.attackOptions EXHAUSTIVELY. If a feature is not listed there, the character DOES NOT have it.",
      "- Check actor.resources.attacksPerAction for how many attacks per Attack action (Extra Attack). If it says 2, the character HAS Extra Attack.",
      "- Check actor.resources.actionAvailable and actor.resources.bonusActionAvailable for what economy slots remain this turn.",
      "- Use only the exact numbers from the context (HP, AC, distances, attack bonuses, damage formulas). Never estimate or recall from memory.",
      "- Be concise and tactical.",
      "- If the question asks for something not in the context (e.g. unknown destination), say what input is needed.",
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
          targetName: d.targetName,
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

  /**
   * POST /sessions/:id/combat/:encounterId/path-preview
   *
   * Preview A* pathfinding without committing a move.
   * Returns the computed path, per-cell metadata, cost, and narration hints.
   *
   * Body:
   *   from: { x: number; y: number }          — origin position
   *   to: { x: number; y: number }            — destination position
   *   maxCostFeet?: number                     — movement budget (default: no limit)
   *   desiredRange?: number                    — stop this many feet from `to` (default: 0 = exact cell)
   *   avoidHazards?: boolean                   — treat lava/pit as impassable (default: true)
   */
  app.post<{
    Params: { id: string; encounterId: string };
    Body: {
      from: unknown;
      to: unknown;
      maxCostFeet?: unknown;
      desiredRange?: unknown;
      avoidHazards?: unknown;
    };
  }>("/sessions/:id/combat/:encounterId/path-preview", async (req) => {
    const { encounterId } = req.params;

    // --- Validate body ---
    const fromRaw = req.body?.from;
    const toRaw = req.body?.to;

    if (
      !fromRaw || typeof fromRaw !== "object" ||
      typeof (fromRaw as any).x !== "number" || typeof (fromRaw as any).y !== "number"
    ) {
      throw new ValidationError("from must be { x: number, y: number }");
    }
    if (
      !toRaw || typeof toRaw !== "object" ||
      typeof (toRaw as any).x !== "number" || typeof (toRaw as any).y !== "number"
    ) {
      throw new ValidationError("to must be { x: number, y: number }");
    }

    const from: Position = { x: (fromRaw as any).x, y: (fromRaw as any).y };
    const to: Position = { x: (toRaw as any).x, y: (toRaw as any).y };

    const maxCostFeetRaw = req.body?.maxCostFeet;
    const maxCostFeet = typeof maxCostFeetRaw === "number" && maxCostFeetRaw > 0 ? maxCostFeetRaw : undefined;

    const desiredRangeRaw = req.body?.desiredRange;
    const desiredRange = typeof desiredRangeRaw === "number" && desiredRangeRaw >= 0 ? desiredRangeRaw : 0;

    const avoidHazardsRaw = req.body?.avoidHazards;
    const avoidHazards = avoidHazardsRaw !== false; // default true

    // --- Load encounter map ---
    const encounter = await deps.combatRepo.getEncounterById(encounterId);
    if (!encounter) {
      throw new NotFoundError(`Encounter ${encounterId} not found`);
    }

    const combatMap = encounter.mapData as unknown as CombatMap | undefined;
    if (!combatMap || !combatMap.width || !combatMap.height) {
      throw new ValidationError("Encounter has no combat map configured");
    }

    // --- Resolve destination (apply desiredRange if > 0) ---
    let destination = to;
    if (desiredRange > 0) {
      const adjacent = findAdjacentPosition(combatMap, to, from, desiredRange);
      if (!adjacent) {
        return {
          blocked: true,
          path: [],
          cells: [],
          totalCostFeet: 0,
          terrainEncountered: [],
          narrationHints: [`No reachable position within ${desiredRange}ft of target.`],
          reachablePosition: null,
        };
      }
      destination = adjacent;
    }

    // --- Collect occupied positions from combatants ---
    const combatants = await deps.combatRepo.listCombatants(encounterId);
    const occupiedPositions = combatants
      .map((c) => {
        const res = (c.resources as Record<string, unknown>) ?? {};
        const pos = res.position as { x: number; y: number } | undefined;
        return pos && typeof pos.x === "number" && typeof pos.y === "number" ? pos : null;
      })
      .filter((p): p is Position => p !== null)
      // Exclude origin so the mover's own position isn't blocked
      .filter((p) => !(p.x === from.x && p.y === from.y));

    // --- Run A* ---
    const pathResult = findPath(combatMap, from, destination, {
      maxCostFeet,
      avoidHazards,
      occupiedPositions,
    });

    return {
      blocked: pathResult.blocked,
      path: pathResult.path,
      cells: pathResult.cells,
      totalCostFeet: pathResult.totalCostFeet,
      terrainEncountered: pathResult.terrainEncountered,
      narrationHints: pathResult.narrationHints,
      reachablePosition: pathResult.reachablePosition ?? null,
    };
  });
}
