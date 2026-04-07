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
        }
      | {
          kind: "classAbility";
          encounterId?: string;
          actor: { type: "Character"; characterId: string };
          abilityId: string;
          target?:
            | { type: "Character"; characterId: string }
            | { type: "Monster"; monsterId: string }
            | { type: "NPC"; npcId: string };
          params?: { variant?: string };
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
      // Check for help action
      const body = req.body as any;

      // Programmatic class ability execution via tabletop parser flow.
      if (body?.kind === "classAbility" || body?.type === "classAbility") {
        if (!body.actor || body.actor.type !== "Character" || typeof body.actor.characterId !== "string") {
          throw new ValidationError("classAbility requires a Character actor");
        }
        if (!body.encounterId || typeof body.encounterId !== "string") {
          throw new ValidationError("classAbility requires encounterId");
        }
        if (!body.abilityId || typeof body.abilityId !== "string") {
          throw new ValidationError("classAbility requires abilityId");
        }

        const normalizedAbilityId = body.abilityId.toLowerCase();
        let text = body.params?.variant ?? body.abilityId;
        if (normalizedAbilityId.includes("forceful")) text = "forceful blow";
        else if (normalizedAbilityId.includes("staggering")) text = "staggering blow";
        else if (normalizedAbilityId.includes("hamstring") || normalizedAbilityId.includes("brutal-strike")) text = "hamstring blow";

        // If a target is provided, append its display name so the dispatcher can resolve it deterministically.
        if (body.target && typeof body.target === "object") {
          let targetName: string | null = null;
          if (body.target.type === "Monster" && typeof body.target.monsterId === "string") {
            const targetMonster = await deps.monsters.getById(body.target.monsterId);
            targetName = targetMonster?.name ?? null;
          } else if (body.target.type === "Character" && typeof body.target.characterId === "string") {
            const targetCharacter = await deps.charactersRepo.getById(body.target.characterId);
            targetName = targetCharacter?.name ?? null;
          } else if (body.target.type === "NPC" && typeof body.target.npcId === "string") {
            const targetNpc = await deps.npcs.getById(body.target.npcId);
            targetName = targetNpc?.name ?? null;
          }
          if (targetName) {
            text = `${text} ${targetName}`;
          }
        }

        return deps.tabletopCombat.parseCombatAction(
          sessionId,
          text,
          body.actor.characterId,
          body.encounterId,
        );
      }

      if (body?.kind === "help") {
        if (!body.actor || !body.target) {
          throw new ValidationError("help action requires actor and target");
        }
        if (deps.unitOfWork) {
          return deps.unitOfWork.run(async (repos) => {
            const services = deps.createServicesForRepos(repos);
            return services.actions.help(sessionId, {
              encounterId: body.encounterId,
              actor: body.actor,
              target: body.target,
            });
          });
        }
        return deps.actions.help(sessionId, {
          encounterId: body.encounterId,
          actor: body.actor,
          target: body.target,
        });
      }

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
