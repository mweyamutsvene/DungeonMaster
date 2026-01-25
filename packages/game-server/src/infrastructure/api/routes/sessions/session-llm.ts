/**
 * Session LLM Routes
 *
 * Handles LLM-powered intent parsing, action execution, and narrative generation.
 *
 * Endpoints:
 * - POST /sessions/:id/llm/intent - Parse natural language to game command
 * - POST /sessions/:id/llm/act - Parse intent and execute action
 * - POST /sessions/:id/llm/narrate - Generate narrative from events
 */

import type { FastifyInstance } from "fastify";
import type { SessionRouteDeps } from "./types.js";
import { ValidationError } from "../../../../application/errors.js";
import { llmDebugLog } from "../../../llm/debug.js";
import {
  buildGameCommandSchemaHint,
  parseGameCommand,
  type LlmRoster,
} from "../../../../application/commands/game-command.js";

export function registerSessionLlmRoutes(app: FastifyInstance, deps: SessionRouteDeps): void {
  /**
   * POST /sessions/:id/llm/intent
   * Parse natural language text into a structured game command via LLM.
   */
  app.post<{
    Params: { id: string };
    Body: { text: unknown; seed?: unknown; schemaHint?: unknown };
  }>("/sessions/:id/llm/intent", async (req) => {
    if (!deps.intentParser) {
      throw new ValidationError("LLM intent parser is not configured");
    }

    const sessionId = req.params.id;
    await deps.sessions.getSessionOrThrow(sessionId);

    const characters = await deps.characters.listCharacters(sessionId);
    const monsters = await deps.monsters.listBySession(sessionId);
    const npcs = await deps.npcs.listBySession(sessionId);

    const roster: LlmRoster = {
      characters: characters.map((c) => ({ id: c.id, name: c.name })),
      monsters: monsters.map((m) => ({ id: m.id, name: m.name })),
      npcs: npcs.map((n) => ({ id: n.id, name: n.name })),
    };

    const text = req.body?.text;
    if (typeof text !== "string" || text.length === 0) {
      throw new ValidationError("text is required");
    }

    const seedRaw = req.body?.seed;
    const seed = typeof seedRaw === "number" ? seedRaw : undefined;
    if (seedRaw !== undefined && seed === undefined) {
      throw new ValidationError("seed must be a number");
    }

    const schemaHintRaw = req.body?.schemaHint;
    const schemaHint = typeof schemaHintRaw === "string" ? schemaHintRaw : undefined;
    if (schemaHintRaw !== undefined && schemaHint === undefined) {
      throw new ValidationError("schemaHint must be a string");
    }

    const hint = schemaHint ?? buildGameCommandSchemaHint(roster);
    llmDebugLog("act.schemaHint", { sessionId, hint, roster, input: { text, seed } });
    const intent = await deps.intentParser.parseIntent({ text, seed, schemaHint: hint });
    llmDebugLog("act.intent", { sessionId, intent });
    const command = parseGameCommand(intent);
    llmDebugLog("act.command", { sessionId, command });
    return { command };
  });

  /**
   * POST /sessions/:id/llm/act
   * Parse intent and immediately execute the resulting action.
   */
  app.post<{
    Params: { id: string };
    Body: { text: unknown; seed?: unknown; schemaHint?: unknown };
  }>("/sessions/:id/llm/act", async (req) => {
    if (!deps.intentParser) {
      throw new ValidationError("LLM intent parser is not configured");
    }

    const sessionId = req.params.id;
    await deps.sessions.getSessionOrThrow(sessionId);

    const text = req.body?.text;
    if (typeof text !== "string" || text.length === 0) {
      throw new ValidationError("text is required");
    }

    const seedRaw = req.body?.seed;
    const seed = typeof seedRaw === "number" ? seedRaw : undefined;
    if (seedRaw !== undefined && seed === undefined) {
      throw new ValidationError("seed must be a number");
    }

    const schemaHintRaw = req.body?.schemaHint;
    const schemaHint = typeof schemaHintRaw === "string" ? schemaHintRaw : undefined;
    if (schemaHintRaw !== undefined && schemaHint === undefined) {
      throw new ValidationError("schemaHint must be a string");
    }

    const characters = await deps.characters.listCharacters(sessionId);
    const monsters = await deps.monsters.listBySession(sessionId);
    const npcs = await deps.npcs.listBySession(sessionId);

    const roster: LlmRoster = {
      characters: characters.map((c) => ({ id: c.id, name: c.name })),
      monsters: monsters.map((m) => ({ id: m.id, name: m.name })),
      npcs: npcs.map((n) => ({ id: n.id, name: n.name })),
    };

    const hint = schemaHint ?? buildGameCommandSchemaHint(roster);
    const intent = await deps.intentParser.parseIntent({ text, seed, schemaHint: hint });
    const command = parseGameCommand(intent);

    const execute = async (services: {
      actions: typeof deps.actions;
      combat: typeof deps.combat;
    }) => {
      if (command.kind === "attack") {
        return services.actions.attack(sessionId, command as any);
      }
      if (command.kind === "endTurn") {
        return services.combat.endTurn(sessionId, { encounterId: command.encounterId, actor: command.actor });
      }
    };

    if (deps.unitOfWork) {
      const outcome = await deps.unitOfWork.run(async (repos) => {
        const services = deps.createServicesForRepos(repos);
        return execute({ actions: services.actions, combat: services.combat });
      });
      return { command, outcome };
    }

    const outcome = await execute({ actions: deps.actions, combat: deps.combat });
    return { command, outcome };
  });

  /**
   * POST /sessions/:id/llm/narrate
   * Generate narrative text from game events via LLM.
   */
  app.post<{
    Params: { id: string };
    Body: { events: unknown; seed?: unknown };
  }>("/sessions/:id/llm/narrate", async (req) => {
    if (!deps.narrativeGenerator) {
      throw new ValidationError("LLM narrative generator is not configured");
    }

    const sessionId = req.params.id;
    const session = await deps.sessions.getSessionOrThrow(sessionId);

    const eventsRaw = req.body?.events;
    if (!Array.isArray(eventsRaw)) {
      throw new ValidationError("events must be an array");
    }

    const seedRaw = req.body?.seed;
    const seed = typeof seedRaw === "number" ? seedRaw : undefined;
    if (seedRaw !== undefined && seed === undefined) {
      throw new ValidationError("seed must be a number");
    }

    const narrative = await deps.narrativeGenerator.narrate({
      storyFramework: session.storyFramework,
      events: eventsRaw as any,
      seed,
    });

    return { narrative };
  });
}
