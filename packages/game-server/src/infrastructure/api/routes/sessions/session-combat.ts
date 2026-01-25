/**
 * Session Combat Routes
 *
 * Handles core combat flow (start, next turn, state).
 *
 * Endpoints:
 * - POST /sessions/:id/combat/start - Start a combat encounter
 * - POST /sessions/:id/combat/next - Advance to next turn
 * - GET /sessions/:id/combat - Get current encounter state
 * - GET /sessions/:id/combat/:encounterId/combatants - List combatants
 */

import type { FastifyInstance } from "fastify";
import type { SessionRouteDeps } from "./types.js";

export function registerSessionCombatRoutes(app: FastifyInstance, deps: SessionRouteDeps): void {
  /**
   * POST /sessions/:id/combat/start
   * Start a new combat encounter with specified combatants.
   */
  app.post<{
    Params: { id: string };
    Body: {
      combatants: Array<{
        combatantType: "Character" | "Monster" | "NPC";
        characterId?: string;
        monsterId?: string;
        npcId?: string;
        initiative?: number | null;
        hpCurrent: number;
        hpMax: number;
        conditions?: unknown;
        resources?: unknown;
      }>;
    };
  }>("/sessions/:id/combat/start", async (req) => {
    const sessionId = req.params.id;

    const input = { combatants: req.body.combatants };

    if (deps.unitOfWork) {
      return deps.unitOfWork.run(async (repos) => {
        const services = deps.createServicesForRepos(repos);
        return services.combat.startEncounter(sessionId, input);
      });
    }

    return deps.combat.startEncounter(sessionId, input);
  });

  /**
   * POST /sessions/:id/combat/next
   * Advance to the next turn in the current encounter.
   */
  app.post<{
    Params: { id: string };
    Body: { encounterId?: string };
  }>("/sessions/:id/combat/next", async (req) => {
    const sessionId = req.params.id;
    const input = { encounterId: req.body?.encounterId };

    if (deps.unitOfWork) {
      return deps.unitOfWork.run(async (repos) => {
        const services = deps.createServicesForRepos(repos);
        return services.combat.nextTurn(sessionId, input);
      });
    }

    return deps.combat.nextTurn(sessionId, input);
  });

  /**
   * GET /sessions/:id/combat
   * Get the current encounter state.
   */
  app.get<{
    Params: { id: string };
    Querystring: { encounterId?: string };
  }>("/sessions/:id/combat", async (req) => {
    const sessionId = req.params.id;
    const input = { encounterId: req.query.encounterId };
    return deps.combat.getEncounterState(sessionId, input);
  });

  /**
   * GET /sessions/:id/combat/:encounterId/combatants
   * List all combatants in an encounter.
   */
  app.get<{
    Params: { id: string; encounterId: string };
  }>("/sessions/:id/combat/:encounterId/combatants", async (req) => {
    const encounterId = req.params.encounterId;
    return deps.combatRepo.listCombatants(encounterId);
  });
}
