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
import { isCharacterClassId } from "../../../../domain/entities/classes/class-definition.js";
import { enrichSheetAttacks } from "../../../../domain/entities/items/weapon-catalog.js";
import { enrichSheetArmor } from "../../../../domain/entities/items/armor-catalog.js";
import { enrichSheetClassFeatures } from "../../../../domain/entities/classes/class-feature-enrichment.js";

type SessionNpcBody = {
  name: unknown;
  statBlock?: unknown;
  className?: unknown;
  level?: unknown;
  sheet?: unknown;
  faction?: unknown;
  aiControlled?: unknown;
  id?: unknown;
};

function buildNpcCreateInput(body: SessionNpcBody, generatedId: string) {
  const name = body?.name;
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new ValidationError("name is required");
  }

  const factionRaw = body?.faction;
  const faction =
    factionRaw === undefined
      ? "party"
      : typeof factionRaw === "string" && factionRaw.trim().length > 0
        ? factionRaw.trim()
        : "party";
  if (factionRaw !== undefined && typeof factionRaw !== "string") {
    throw new ValidationError("faction must be a string");
  }

  const aiControlledRaw = body?.aiControlled;
  const aiControlled =
    aiControlledRaw === undefined ? true : typeof aiControlledRaw === "boolean" ? aiControlledRaw : true;
  if (aiControlledRaw !== undefined && typeof aiControlledRaw !== "boolean") {
    throw new ValidationError("aiControlled must be a boolean");
  }

  const hasStatBlock = body?.statBlock !== undefined;
  const hasClassBackedFields = body?.className !== undefined || body?.level !== undefined || body?.sheet !== undefined;
  if (hasStatBlock === hasClassBackedFields) {
    throw new ValidationError("NPC payload must include exactly one representation: statBlock or className/level/sheet");
  }

  if (hasStatBlock) {
    const statBlock = body.statBlock;
    if (typeof statBlock !== "object" || statBlock === null || Array.isArray(statBlock)) {
      throw new ValidationError("statBlock must be an object");
    }
    return {
      id: generatedId,
      name: name.trim(),
      statBlock,
      faction,
      aiControlled,
    };
  }

  const className = body.className;
  if (typeof className !== "string" || className.trim().length === 0) {
    throw new ValidationError("className is required for class-backed NPCs");
  }
  const normalizedClassId = className.trim().toLowerCase();
  if (!isCharacterClassId(normalizedClassId)) {
    throw new ValidationError(`Unknown character class: "${className}"`);
  }

  const rawLevel = body.level;
  if (!Number.isInteger(rawLevel) || (rawLevel as number) < 1 || (rawLevel as number) > 20) {
    throw new ValidationError("level must be an integer from 1 to 20 for class-backed NPCs");
  }
  const level = rawLevel as number;

  const sheet = body.sheet;
  if (typeof sheet !== "object" || sheet === null || Array.isArray(sheet)) {
    throw new ValidationError("sheet must be an object for class-backed NPCs");
  }

  const enrichedSheet = enrichSheetClassFeatures(
    enrichSheetArmor(enrichSheetAttacks(sheet as Record<string, unknown>)),
    level,
    className.trim(),
  );

  // Class-backed spellcasters should provide `preparedSpells` and/or `spells` on `sheet`.
  // Cast-time preparation enforcement checks those lists for leveled spells.

  return {
    id: generatedId,
    name: name.trim(),
    className: className.trim(),
    level,
    sheet: {
      ...enrichedSheet,
      className: className.trim(),
      level,
    },
    faction,
    aiControlled,
  };
}

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
    Body: SessionNpcBody;
  }>("/sessions/:id/npcs", async (req) => {
    const sessionId = req.params.id;
    await deps.sessions.getSessionOrThrow(sessionId);

    const idRaw = req.body?.id;
    const id = typeof idRaw === "string" && idRaw.length > 0 ? idRaw : nanoid(21);
    if (idRaw !== undefined && (typeof idRaw !== "string" || idRaw.length === 0)) {
      throw new ValidationError("id must be a non-empty string");
    }

    const createInput = buildNpcCreateInput(req.body, id);

    if (deps.unitOfWork) {
      const created = await deps.unitOfWork.run(async (repos) => {
        const n = await repos.npcsRepo.createInSession(sessionId, createInput);
        await repos.eventsRepo.append(sessionId, {
          id: nanoid(),
          type: "NPCAdded",
          payload: { npcId: n.id, name: n.name },
        });
        return n;
      });
      return created;
    }

    const created = await deps.npcs.createInSession(sessionId, createInput);
    await deps.events.append(sessionId, {
      id: nanoid(),
      type: "NPCAdded",
      payload: { npcId: created.id, name: created.name },
    });
    return created;
  });
}
