/**
 * Session Actions Routes
 *
 * Handles structured action execution (programmatic, not tabletop).
 *
 * Endpoints:
 * - POST /sessions/:id/actions - Execute structured actions (endTurn, attack)
 */

import type { FastifyInstance } from "fastify";
import type { SessionRouteDeps } from "./types.js";
import { ValidationError } from "../../../../application/errors.js";

export function registerSessionActionsRoutes(app: FastifyInstance, deps: SessionRouteDeps): void {
  /**
   * POST /sessions/:id/actions
   * Execute a structured action (endTurn or attack).
   * This is the programmatic combat interface (vs tabletop's natural language flow).
   */
  app.post<{
    Params: { id: string };
    Body:
      | {
          kind: "endTurn";
          encounterId?: string;
          actor: { type: "Character"; characterId: string } | { type: "Monster"; monsterId: string };
        }
      | {
          kind: "attack";
          encounterId?: string;
          attacker: { type: "Character"; characterId: string } | { type: "Monster"; monsterId: string };
          target: { type: "Character"; characterId: string } | { type: "Monster"; monsterId: string };
          seed?: number;
          spec?: unknown;
          monsterAttackName?: string;
        };
  }>("/sessions/:id/actions", async (req) => {
    const sessionId = req.params.id;

    if (req.body?.kind === "endTurn") {
      const input = { encounterId: req.body.encounterId, actor: req.body.actor };

      if (deps.unitOfWork) {
        const result = await deps.unitOfWork.run(async (repos) => {
          const services = deps.createServicesForRepos(repos);
          return services.combat.endTurn(sessionId, input);
        });

        if (deps.aiOrchestrator && typeof req.body.encounterId === "string") {
          void deps.aiOrchestrator.processAllMonsterTurns(sessionId, req.body.encounterId).catch((err: Error) => {
            console.error("Error processing monster turns after endTurn:", err);
          });
        }

        return result;
      }

      const result = await deps.combat.endTurn(sessionId, input);

      if (deps.aiOrchestrator && typeof req.body.encounterId === "string") {
        void deps.aiOrchestrator.processAllMonsterTurns(sessionId, req.body.encounterId).catch((err: Error) => {
          console.error("Error processing monster turns after endTurn:", err);
        });
      }

      return result;
    }

    if (req.body?.kind !== "attack") {
      throw new ValidationError("Unsupported action kind");
    }

    if (deps.unitOfWork) {
      return deps.unitOfWork.run(async (repos) => {
        const services = deps.createServicesForRepos(repos);
        return services.actions.attack(sessionId, req.body as any);
      });
    }

    return deps.actions.attack(sessionId, req.body as any);
  });
}
