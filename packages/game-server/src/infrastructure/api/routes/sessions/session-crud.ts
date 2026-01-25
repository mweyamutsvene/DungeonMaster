/**
 * Session CRUD Routes
 *
 * Handles session creation and retrieval.
 *
 * Endpoints:
 * - POST /sessions - Create a new game session
 * - GET /sessions/:id - Get session with characters, monsters, NPCs
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
}
