/**
 * Session Characters Routes
 *
 * Handles character management within a session.
 *
 * Endpoints:
 * - POST /sessions/:id/characters - Add a character to a session
 * - DELETE /sessions/:id/characters/:characterId - Remove a character from a session
 * - POST /sessions/:id/characters/generate - Generate a character via LLM
 * - POST /sessions/:id/rest/begin - Begin a rest (records start time for interruption detection)
 * - POST /sessions/:id/rest - Take a short or long rest (refreshes resources)
 */

import type { FastifyInstance } from "fastify";
import type { SessionRouteDeps } from "./types.js";
import { NotFoundError, ValidationError } from "../../../../application/errors.js";
import { breakConcentration, getConcentrationSpellName } from "../../../../application/services/combat/helpers/concentration-helper.js";

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
   * DELETE /sessions/:id/characters/:characterId
   * Remove a character from the session.
   */
  app.delete<{
    Params: { id: string; characterId: string };
  }>("/sessions/:id/characters/:characterId", async (req) => {
    const sessionId = req.params.id;
    await deps.sessions.getSessionOrThrow(sessionId);

    const character = await deps.charactersRepo.getById(req.params.characterId);
    if (!character || character.sessionId !== sessionId) {
      throw new NotFoundError(`Character ${req.params.characterId} not found in session ${sessionId}`);
    }

    await deps.charactersRepo.delete(req.params.characterId);
    return { deleted: true };
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

  /**
   * POST /sessions/:id/rest/begin
   * Begin a rest for the session. Records the start time via a RestStarted event so
   * that interruptions (combat started, damage taken during long rest) can be detected
   * when the rest completes via POST /sessions/:id/rest.
   *
   * Returns { restId, restType, startedAt } — pass `startedAt` back to /rest to
   * enable interruption detection.
   */
  app.post<{
    Params: { id: string };
    Body: { type: "short" | "long" };
  }>("/sessions/:id/rest/begin", async (req) => {
    const sessionId = req.params.id;
    const { type: restType } = req.body;

    if (!restType || (restType !== "short" && restType !== "long")) {
      throw new ValidationError("Rest type must be 'short' or 'long'");
    }

    return deps.characters.beginRest(sessionId, restType);
  });

  /**
   * POST /sessions/:id/rest
   * Take a short or long rest for all characters in the session.
   * Refreshes class resource pools; long rest also restores HP.
   * Optional hitDiceSpending: { [characterId]: count } to spend Hit Dice on short rest.
   * Optional restStartedAt: ISO timestamp from POST /rest/begin — if provided, checks
   * for combat or damage interruptions since that time. Returns { interrupted: true } if
   * the rest was interrupted without applying any benefits.
   */
  app.post<{
    Params: { id: string };
    Body: { type: "short" | "long"; hitDiceSpending?: Record<string, number>; restStartedAt?: string };
  }>("/sessions/:id/rest", async (req) => {
    const sessionId = req.params.id;
    const { type: restType, hitDiceSpending, restStartedAt } = req.body;

    if (!restType || (restType !== "short" && restType !== "long")) {
      throw new ValidationError("Rest type must be 'short' or 'long'");
    }

    const startedAt = restStartedAt ? new Date(restStartedAt) : undefined;

    let result: Awaited<ReturnType<typeof deps.characters.takeSessionRest>>;

    if (deps.unitOfWork) {
      result = await deps.unitOfWork.run(async (repos) => {
        const services = deps.createServicesForRepos(repos);
        return services.characters.takeSessionRest(sessionId, restType, hitDiceSpending, startedAt);
      });
    } else {
      result = await deps.characters.takeSessionRest(sessionId, restType, hitDiceSpending, startedAt);
    }

    // Clear concentration on all combatants in any active encounter (D&D 5e: rest ends concentration)
    if (!result.interrupted) {
      const activeEncounter = await deps.combatRepo.findActiveEncounter(sessionId);
      if (activeEncounter) {
        const combatants = await deps.combatRepo.listCombatants(activeEncounter.id);
        for (const c of combatants) {
          if (getConcentrationSpellName(c.resources)) {
            await breakConcentration(c, activeEncounter.id, deps.combatRepo);
          }
        }
      }
    }

    return result;
  });
}
