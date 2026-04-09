/**
 * Session CRUD Routes
 *
 * Handles session creation, retrieval, listing, and deletion.
 *
 * Endpoints:
 * - POST /sessions - Create a new game session
 * - GET /sessions - List sessions with pagination
 * - GET /sessions/:id - Get session with characters, monsters, NPCs
 * - DELETE /sessions/:id - Delete a session and all related data
 */

import type { FastifyInstance } from "fastify";
import type { SessionRouteDeps } from "./types.js";
import { createDebugLogger } from "./types.js";

export function registerSessionCrudRoutes(app: FastifyInstance, deps: SessionRouteDeps): void {
  const debug = createDebugLogger();

  /**
   * POST /sessions
   * Create a new game session, optionally generating a story framework via LLM.
   */
  app.post<{ Body?: { storyFramework?: unknown; storySeed?: number } }>("/sessions", async (req) => {
    let storyFramework: unknown = req.body?.storyFramework;

    if (storyFramework === undefined && deps.storyGenerator) {
      try {
        storyFramework = await deps.storyGenerator.generateStoryFramework({ seed: req.body?.storySeed });
      } catch (err) {
        debug.error("storyGenerator.generateStoryFramework failed; continuing without story framework", err);
        storyFramework = {
          opening: "",
          arc: "",
          ending: "",
          checkpoints: [],
        };
      }
    }

    if (storyFramework === undefined) storyFramework = {};

    if (deps.unitOfWork) {
      return deps.unitOfWork.run(async (repos) => {
        const services = deps.createServicesForRepos(repos);
        return services.sessions.createSession({ storyFramework });
      });
    }

    return deps.sessions.createSession({ storyFramework });
  });

  /**
   * GET /sessions
   * List all sessions with optional pagination.
   * Query params: limit (default 50), offset (default 0)
   */
  app.get<{ Querystring: { limit?: string; offset?: string } }>("/sessions", async (req) => {
    const limit = Math.min(Math.max(parseInt(req.query.limit ?? "50", 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset ?? "0", 10) || 0, 0);
    const result = await deps.sessions.listSessions({ limit, offset });
    return {
      sessions: result.items,
      pagination: { limit, offset, total: result.total },
    };
  });

  /**
   * GET /sessions/:id
   * Retrieve a session with its characters, monsters, and NPCs.
   */
  app.get<{ Params: { id: string } }>("/sessions/:id", async (req) => {
    const sessionId = req.params.id;
    const session = await deps.sessions.getSessionOrThrow(sessionId);
    const characters = await deps.characters.listCharacters(sessionId);
    const monsters = await deps.monsters.listBySession(sessionId);
    const npcs = await deps.npcs.listBySession(sessionId);

    return {
      session,
      characters,
      monsters,
    };
  });

  /**
   * DELETE /sessions/:id
   * Delete a session and all related data (characters, encounters, events, etc.).
   * Prisma cascade rules handle child record deletion.
   */
  app.delete<{ Params: { id: string } }>("/sessions/:id", async (req, reply) => {
    await deps.sessions.deleteSession(req.params.id);
    return reply.code(204).send();
  });
}
