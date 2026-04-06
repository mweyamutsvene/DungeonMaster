/**
 * Session Creatures Routes
 *
 * Handles monster and NPC management within a session.
 *
 * Endpoints:
 * - POST /sessions/:id/monsters - Add a monster to a session
 * - DELETE /sessions/:id/monsters/:monsterId - Remove a monster from a session
 * - POST /sessions/:id/npcs - Add an NPC to a session
 */

import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import type { SessionRouteDeps } from "./types.js";
import { NotFoundError, ValidationError } from "../../../../application/errors.js";

export function registerSessionCreatureRoutes(app: FastifyInstance, deps: SessionRouteDeps): void {
  /**
   * POST /sessions/:id/monsters
   * Add a monster with a stat block to the session.
   */
  app.post<{
    Params: { id: string };
    Body: { name: unknown; statBlock: unknown; monsterDefinitionId?: unknown; id?: unknown };
  }>("/sessions/:id/monsters", async (req) => {
    const sessionId = req.params.id;
    await deps.sessions.getSessionOrThrow(sessionId);

    const name = req.body?.name;
    if (typeof name !== "string" || name.trim().length === 0) {
      throw new ValidationError("name is required");
    }

    const statBlock = req.body?.statBlock;
    if (typeof statBlock !== "object" || statBlock === null || Array.isArray(statBlock)) {
      throw new ValidationError("statBlock must be an object");
    }

    const monsterDefinitionIdRaw = req.body?.monsterDefinitionId;
    const monsterDefinitionId =
      monsterDefinitionIdRaw === undefined
        ? null
        : monsterDefinitionIdRaw === null
          ? null
          : typeof monsterDefinitionIdRaw === "string" && monsterDefinitionIdRaw.length > 0
            ? monsterDefinitionIdRaw
            : null;
    if (monsterDefinitionIdRaw !== undefined && monsterDefinitionIdRaw !== null && monsterDefinitionId === null) {
      throw new ValidationError("monsterDefinitionId must be a string or null");
    }

    const idRaw = req.body?.id;
    const id = typeof idRaw === "string" && idRaw.length > 0 ? idRaw : nanoid(21);
    if (idRaw !== undefined && (typeof idRaw !== "string" || idRaw.length === 0)) {
      throw new ValidationError("id must be a non-empty string");
    }

    if (deps.unitOfWork) {
      const created = await deps.unitOfWork.run(async (repos) => {
        const m = await repos.monstersRepo.createInSession(sessionId, {
          id,
          name: name.trim(),
          monsterDefinitionId,
          statBlock,
        });
        await repos.eventsRepo.append(sessionId, {
          id: nanoid(),
          type: "MonsterAdded",
          payload: { monsterId: m.id, name: m.name },
        });
        return m;
      });
      return created;
    }

    const created = await deps.monsters.createInSession(sessionId, {
      id,
      name: name.trim(),
      monsterDefinitionId,
      statBlock,
    });
    await deps.events.append(sessionId, {
      id: nanoid(),
      type: "MonsterAdded",
      payload: { monsterId: created.id, name: created.name },
    });
    return created;
  });

  /**
   * DELETE /sessions/:id/monsters/:monsterId
   * Remove a monster from the session.
   */
  app.delete<{
    Params: { id: string; monsterId: string };
  }>("/sessions/:id/monsters/:monsterId", async (req) => {
    const sessionId = req.params.id;
    await deps.sessions.getSessionOrThrow(sessionId);

    const monster = await deps.monsters.getById(req.params.monsterId);
    if (!monster || monster.sessionId !== sessionId) {
      throw new NotFoundError(`Monster ${req.params.monsterId} not found in session ${sessionId}`);
    }

    await deps.monsters.delete(req.params.monsterId);
    return { deleted: true };
  });

  /**
   * POST /sessions/:id/npcs
   * Add an NPC with a stat block to the session.
   */
  app.post<{
    Params: { id: string };
    Body: { name: unknown; statBlock: unknown; faction?: unknown; aiControlled?: unknown; id?: unknown };
  }>("/sessions/:id/npcs", async (req) => {
    const sessionId = req.params.id;
    await deps.sessions.getSessionOrThrow(sessionId);

    const name = req.body?.name;
    if (typeof name !== "string" || name.trim().length === 0) {
      throw new ValidationError("name is required");
    }

    const statBlock = req.body?.statBlock;
    if (typeof statBlock !== "object" || statBlock === null || Array.isArray(statBlock)) {
      throw new ValidationError("statBlock must be an object");
    }

    const factionRaw = req.body?.faction;
    const faction =
      factionRaw === undefined
        ? "party"
        : typeof factionRaw === "string" && factionRaw.trim().length > 0
          ? factionRaw.trim()
          : "party";
    if (factionRaw !== undefined && typeof factionRaw !== "string") {
      throw new ValidationError("faction must be a string");
    }

    const aiControlledRaw = req.body?.aiControlled;
    const aiControlled =
      aiControlledRaw === undefined ? true : typeof aiControlledRaw === "boolean" ? aiControlledRaw : true;
    if (aiControlledRaw !== undefined && typeof aiControlledRaw !== "boolean") {
      throw new ValidationError("aiControlled must be a boolean");
    }

    const idRaw = req.body?.id;
    const id = typeof idRaw === "string" && idRaw.length > 0 ? idRaw : nanoid(21);
    if (idRaw !== undefined && (typeof idRaw !== "string" || idRaw.length === 0)) {
      throw new ValidationError("id must be a non-empty string");
    }

    if (deps.unitOfWork) {
      const created = await deps.unitOfWork.run(async (repos) => {
        const n = await repos.npcsRepo.createInSession(sessionId, {
          id,
          name: name.trim(),
          statBlock,
          faction,
          aiControlled,
        });
        await repos.eventsRepo.append(sessionId, {
          id: nanoid(),
          type: "NPCAdded",
          payload: { npcId: n.id, name: n.name },
        });
        return n;
      });
      return created;
    }

    const created = await deps.npcs.createInSession(sessionId, {
      id,
      name: name.trim(),
      statBlock,
      faction,
      aiControlled,
    });
    await deps.events.append(sessionId, {
      id: nanoid(),
      type: "NPCAdded",
      payload: { npcId: created.id, name: created.name },
    });
    return created;
  });
}
