/**
 * Session Characters Routes
 *
 * Handles character management within a session.
 *
 * Endpoints:
 * - POST /sessions/:id/characters - Add a character to a session
 * - POST /sessions/:id/characters/generate - Generate a character via LLM
 */

import type { FastifyInstance } from "fastify";
import type { SessionRouteDeps } from "./types.js";
import { ValidationError } from "../../../../application/errors.js";

export function registerSessionCharacterRoutes(app: FastifyInstance, deps: SessionRouteDeps): void {
  /**
   * POST /sessions/:id/characters
   * Add a character with a provided sheet to the session.
   */
  app.post<{
    Params: { id: string };
    Body: { name: string; level: number; className?: string | null; sheet: unknown };
  }>("/sessions/:id/characters", async (req) => {
    const sessionId = req.params.id;

    const input = {
      name: req.body.name,
      level: req.body.level,
      className: req.body.className ?? null,
      sheet: req.body.sheet,
    };

    if (deps.unitOfWork) {
      return deps.unitOfWork.run(async (repos) => {
        const services = deps.createServicesForRepos(repos);
        return services.characters.addCharacter(sessionId, input);
      });
    }

    return deps.characters.addCharacter(sessionId, input);
  });

  /**
   * POST /sessions/:id/characters/generate
   * Generate a character sheet via LLM or use a provided sheet.
   */
  app.post<{
    Params: { id: string };
    Body: { name: string; className: string; level?: number; sheet?: unknown; seed?: number };
  }>("/sessions/:id/characters/generate", async (req) => {
    const sessionId = req.params.id;

    const name = req.body.name;
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      throw new ValidationError("name is required");
    }

    const className = req.body.className;
    if (!className || typeof className !== "string" || className.trim().length === 0) {
      throw new ValidationError("className is required");
    }

    const level = req.body.level ?? 1;
    const seed = req.body.seed;

    // If sheet provided, use it directly; otherwise generate via LLM
    let sheet = req.body.sheet;
    if (!sheet && deps.characterGenerator) {
      sheet = await deps.characterGenerator.generateCharacter({
        className,
        level,
        seed,
      });
    }

    if (!sheet) {
      throw new ValidationError("No character sheet provided and no character generator available");
    }

    const input = {
      name,
      level,
      className,
      sheet,
    };

    if (deps.unitOfWork) {
      return deps.unitOfWork.run(async (repos) => {
        const services = deps.createServicesForRepos(repos);
        return services.characters.addCharacter(sessionId, input);
      });
    }

    return deps.characters.addCharacter(sessionId, input);
  });
}
