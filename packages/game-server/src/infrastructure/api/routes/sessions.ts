import type { FastifyInstance } from "fastify";

import type { ActionService } from "../../../application/services/combat/action-service.js";
import type { CharacterService } from "../../../application/services/entities/character-service.js";
import type { CombatService } from "../../../application/services/combat/combat-service.js";
import type { TwoPhaseActionService } from "../../../application/services/combat/two-phase-action-service.js";
import type { GameSessionService } from "../../../application/services/entities/game-session-service.js";
import type { AiTurnOrchestrator } from "../../../application/services/combat/ai/index.js";
import type { IEventRepository } from "../../../application/repositories/event-repository.js";
import type { IMonsterRepository } from "../../../application/repositories/monster-repository.js";
import type { INPCRepository } from "../../../application/repositories/npc-repository.js";
import type { ICombatRepository } from "../../../application/repositories/combat-repository.js";
import type { PendingActionRepository } from "../../../application/repositories/pending-action-repository.js";
import { ValidationError, NotFoundError } from "../../../application/errors.js";
import { llmDebugLog } from "../../llm/debug.js";
import { nanoid } from "nanoid";
import type { RepositoryBundle } from "../../db/unit-of-work.js";
import type { PrismaUnitOfWork } from "../../db/unit-of-work.js";
import type { IStoryGenerator } from "../../llm/story-generator.js";
import type { IIntentParser } from "../../llm/intent-parser.js";
import type { INarrativeGenerator } from "../../llm/narrative-generator.js";
import type { ICharacterGenerator } from "../../llm/character-generator.js";
import {
  buildGameCommandSchemaHint,
  parseGameCommand,
  type LlmRoster,
} from "../../../application/commands/game-command.js";
import { calculateDistance, crossesThroughReach } from "../../../domain/rules/movement.js";
import { getMartialArtsDieSize } from "../../../domain/rules/martial-arts-die.js";
import {
  getPosition,
  getResourcePools,
  normalizeResources,
  readBoolean,
} from "../../../application/services/combat/helpers/resource-utils.js";

export function registerSessionRoutes(
  app: FastifyInstance,
  deps: {
    sessions: GameSessionService;
    characters: CharacterService;
    combat: CombatService;
    actions: ActionService;
    twoPhaseActions: TwoPhaseActionService;
    pendingActions: PendingActionRepository;
    aiOrchestrator?: AiTurnOrchestrator;
    events: IEventRepository;
    combatRepo: ICombatRepository;
    monsters: IMonsterRepository;
    npcs: INPCRepository;
    unitOfWork?: PrismaUnitOfWork;
    storyGenerator?: IStoryGenerator;
    intentParser?: IIntentParser;
    narrativeGenerator?: INarrativeGenerator;
    characterGenerator?: ICharacterGenerator;
    createServicesForRepos: (repos: RepositoryBundle) => {
      sessions: GameSessionService;
      characters: CharacterService;
      combat: CombatService;
      actions: ActionService;
      aiOrchestrator: AiTurnOrchestrator;
    };
  },
): void {
  const debugLogsEnabled =
    process.env.DM_DEBUG_LOGS === "1" ||
    process.env.DM_DEBUG_LOGS === "true" ||
    process.env.DM_DEBUG_LOGS === "yes";

  const debugLog = (...args: unknown[]) => {
    if (debugLogsEnabled) console.log(...args);
  };

  const debugError = (...args: unknown[]) => {
    if (debugLogsEnabled) console.error(...args);
  };

  app.post<{ Body?: { storyFramework?: unknown; storySeed?: number } }>("/sessions", async (req) => {
    let storyFramework: unknown = req.body?.storyFramework;

    if (storyFramework === undefined && deps.storyGenerator) {
      try {
        storyFramework = await deps.storyGenerator.generateStoryFramework({ seed: req.body?.storySeed });
      } catch (err) {
        debugError('storyGenerator.generateStoryFramework failed; continuing without story framework', err);
        storyFramework = {
          opening: '',
          arc: '',
          ending: '',
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

  app.post<{
    Params: { id: string };
    Body: { text: unknown; seed?: unknown; schemaHint?: unknown };
  }>("/sessions/:id/llm/intent", async (req) => {
    if (!deps.intentParser) throw new ValidationError("LLM intent parser is not configured");

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

  app.post<{
    Params: { id: string };
    Body: { text: unknown; seed?: unknown; schemaHint?: unknown };
  }>("/sessions/:id/llm/act", async (req) => {
    if (!deps.intentParser) throw new ValidationError("LLM intent parser is not configured");

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
      actions: ActionService;
      combat: CombatService;
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

  app.post<{
    Params: { id: string };
    Body: { events: unknown; seed?: unknown };
  }>("/sessions/:id/llm/narrate", async (req) => {
    if (!deps.narrativeGenerator) throw new ValidationError("LLM narrative generator is not configured");

    const sessionId = req.params.id;
    const session = await deps.sessions.getSessionOrThrow(sessionId);

    const eventsRaw = req.body?.events;
    if (!Array.isArray(eventsRaw)) throw new ValidationError("events must be an array");

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
      return deps.unitOfWork.run(async (repos) => {
        return repos.monstersRepo.createInSession(sessionId, {
          id,
          name: name.trim(),
          monsterDefinitionId,
          statBlock,
        });
      });
    }

    return deps.monsters.createInSession(sessionId, {
      id,
      name: name.trim(),
      monsterDefinitionId,
      statBlock,
    });
  });

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
      aiControlledRaw === undefined
        ? true
        : typeof aiControlledRaw === "boolean"
          ? aiControlledRaw
          : true;
    if (aiControlledRaw !== undefined && typeof aiControlledRaw !== "boolean") {
      throw new ValidationError("aiControlled must be a boolean");
    }

    const idRaw = req.body?.id;
    const id = typeof idRaw === "string" && idRaw.length > 0 ? idRaw : nanoid(21);
    if (idRaw !== undefined && (typeof idRaw !== "string" || idRaw.length === 0)) {
      throw new ValidationError("id must be a non-empty string");
    }

    if (deps.unitOfWork) {
      return deps.unitOfWork.run(async (repos) => {
        return repos.npcsRepo.createInSession(sessionId, {
          id,
          name: name.trim(),
          statBlock,
          faction,
          aiControlled,
        });
      });
    }

    return deps.npcs.createInSession(sessionId, {
      id,
      name: name.trim(),
      statBlock,
      faction,
      aiControlled,
    });
  });

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

  app.get<{
    Params: { id: string };
    Querystring: { encounterId?: string };
  }>("/sessions/:id/combat", async (req) => {
    const sessionId = req.params.id;
    const input = { encounterId: req.query.encounterId };
    return deps.combat.getEncounterState(sessionId, input);
  });

  app.get<{
    Params: { id: string; encounterId: string };
  }>("/sessions/:id/combat/:encounterId/tactical", async (req) => {
    const sessionId = req.params.id;
    const encounterId = req.params.encounterId;

    const { encounter, combatants, activeCombatant } = await deps.combat.getEncounterState(sessionId, {
      encounterId,
    });

    const characters = await deps.characters.listCharacters(sessionId);
    const monsters = await deps.monsters.listBySession(sessionId);
    const npcs = await deps.npcs.listBySession(sessionId);

    const characterById = new Map(characters.map((c) => [c.id, c] as const));

    const activeResourcesRaw = (activeCombatant as any)?.resources ?? {};
    const activeResources = normalizeResources(activeResourcesRaw);
    const activePos = getPosition(activeResourcesRaw);

    const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;

    const deriveResourcePoolsFromSheet = (sheet: unknown): Array<{ name: string; current: number; max: number }> => {
      if (!isRecord(sheet)) return [];

      const out: Array<{ name: string; current: number; max: number }> = [];

      const kiPoints = sheet.kiPoints;
      if (typeof kiPoints === "number" && Number.isFinite(kiPoints)) {
        out.push({ name: "Ki", current: kiPoints, max: kiPoints });
      }

      const spellSlots = (sheet as any).spellSlots;
      if (isRecord(spellSlots)) {
        for (const [levelKey, raw] of Object.entries(spellSlots)) {
          const poolName = `spellSlots${levelKey}`;
          if (typeof raw === "number" && Number.isFinite(raw)) {
            out.push({ name: poolName, current: raw, max: raw });
            continue;
          }
          if (isRecord(raw) && typeof raw.current === "number" && typeof raw.max === "number") {
            out.push({ name: poolName, current: raw.current, max: raw.max });
          }
        }
      }

      return out;
    };

    const mergePools = (
      fromSheet: Array<{ name: string; current: number; max: number }>,
      fromResources: Array<{ name: string; current: number; max: number }>,
    ): Array<{ name: string; current: number; max: number }> => {
      const byName = new Map<string, { name: string; current: number; max: number }>();
      for (const p of fromSheet) byName.set(p.name, p);
      for (const p of fromResources) byName.set(p.name, p);
      return Array.from(byName.values());
    };

    const parseActionEconomy = (
      resourcesRaw: unknown,
    ): {
      actionAvailable: boolean;
      bonusActionAvailable: boolean;
      reactionAvailable: boolean;
      movementRemainingFeet: number;
    } => {
      const resources = normalizeResources(resourcesRaw);

      const actionSpent = readBoolean(resources, "actionSpent") ?? false;

      // Support both historical naming styles.
      const bonusActionUsed =
        (readBoolean(resources, "bonusActionUsed") ?? false) ||
        (readBoolean(resources, "bonusActionSpent") ?? false);

      const reactionUsed =
        (readBoolean(resources, "reactionUsed") ?? false) ||
        (readBoolean(resources, "reactionSpent") ?? false);

      const movementSpent = readBoolean(resources, "movementSpent") ?? false;
      const dashed = readBoolean(resources, "dashed") ?? false;

      const speed = typeof resources.speed === "number" ? resources.speed : 30;
      const effectiveSpeed = dashed ? speed * 2 : speed;
      const movementRemainingRaw = (resources as any).movementRemaining;
      const movementRemainingFeet =
        typeof movementRemainingRaw === "number"
          ? movementRemainingRaw
          : movementSpent
            ? 0
            : effectiveSpeed;

      return {
        actionAvailable: !actionSpent,
        bonusActionAvailable: !bonusActionUsed,
        reactionAvailable: !reactionUsed,
        movementRemainingFeet,
      };
    };

    const nameFor = (c: any): string => {
      if (c.combatantType === "Character" && c.characterId) {
        return characters.find((x) => x.id === c.characterId)?.name ?? c.characterId;
      }
      if (c.combatantType === "Monster" && c.monsterId) {
        return monsters.find((x) => x.id === c.monsterId)?.name ?? c.monsterId;
      }
      if (c.combatantType === "NPC" && c.npcId) {
        return npcs.find((x) => x.id === c.npcId)?.name ?? c.npcId;
      }
      return c.id;
    };

    return {
      encounterId: encounter.id,
      activeCombatantId: (activeCombatant as any).id,
      combatants: (combatants as any[]).map((c) => {
        const resourcesRaw = c.resources ?? {};
        const resources = normalizeResources(resourcesRaw);
        const pos = getPosition(resourcesRaw);
        const distanceFromActive = activePos && pos ? calculateDistance(activePos, pos) : null;

        const sheetPools =
          c.combatantType === "Character" && c.characterId
            ? deriveResourcePoolsFromSheet(characterById.get(c.characterId)?.sheet)
            : [];
        const storedPools = getResourcePools(resourcesRaw);
        const resourcePools = mergePools(sheetPools, storedPools);

        const actionEconomy = parseActionEconomy(resourcesRaw);

        return {
          id: c.id,
          name: nameFor(c),
          combatantType: c.combatantType,
          hp: { current: c.hpCurrent, max: c.hpMax },
          position: pos ?? null,
          distanceFromActive,
          actionEconomy,
          resourcePools,
          movement: {
            speed: typeof resources.speed === "number" ? resources.speed : 30,
            dashed: readBoolean(resources, "dashed") ?? false,
            movementSpent: readBoolean(resources, "movementSpent") ?? false,
          },
          turnFlags: {
            actionSpent: readBoolean(resources, "actionSpent") ?? false,
            bonusActionUsed:
              (readBoolean(resources, "bonusActionUsed") ?? false) ||
              (readBoolean(resources, "bonusActionSpent") ?? false),
            reactionUsed:
              (readBoolean(resources, "reactionUsed") ?? false) ||
              (readBoolean(resources, "reactionSpent") ?? false),
            disengaged: readBoolean(resources, "disengaged") ?? false,
          },
        };
      }),
      map: (encounter as any).mapData ?? null,
    };
  });

  app.post<{
    Params: { id: string };
    Body: { query: unknown; actorId: unknown; encounterId: unknown; seed?: unknown };
  }>("/sessions/:id/combat/query", async (req) => {
    if (!deps.intentParser) throw new ValidationError("LLM intent parser is not configured");

    const sessionId = req.params.id;
    const queryRaw = req.body?.query;
    const actorIdRaw = req.body?.actorId;
    const encounterIdRaw = req.body?.encounterId;

    if (typeof queryRaw !== "string" || queryRaw.trim().length === 0) {
      throw new ValidationError("query is required");
    }
    if (typeof actorIdRaw !== "string" || actorIdRaw.trim().length === 0) {
      throw new ValidationError("actorId is required");
    }
    if (typeof encounterIdRaw !== "string" || encounterIdRaw.trim().length === 0) {
      throw new ValidationError("encounterId is required");
    }

    const seedRaw = req.body?.seed;
    const seed = typeof seedRaw === "number" ? seedRaw : undefined;
    if (seedRaw !== undefined && seed === undefined) {
      throw new ValidationError("seed must be a number");
    }

    const query = queryRaw.trim();
    const actorCharacterId = actorIdRaw.trim();
    const encounterId = encounterIdRaw.trim();

    const { encounter, combatants, activeCombatant } = await deps.combat.getEncounterState(sessionId, {
      encounterId,
    });

    const characters = await deps.characters.listCharacters(sessionId);
    const monsters = await deps.monsters.listBySession(sessionId);
    const npcs = await deps.npcs.listBySession(sessionId);

    const characterById = new Map(characters.map((c) => [c.id, c] as const));
    const monsterById = new Map(monsters.map((m) => [m.id, m] as const));
    const npcById = new Map(npcs.map((n) => [n.id, n] as const));

    const nameFor = (c: any): string => {
      if (c.combatantType === "Character" && c.characterId) {
        return characterById.get(c.characterId)?.name ?? c.characterId;
      }
      if (c.combatantType === "Monster" && c.monsterId) {
        return monsterById.get(c.monsterId)?.name ?? c.monsterId;
      }
      if (c.combatantType === "NPC" && c.npcId) {
        return npcById.get(c.npcId)?.name ?? c.npcId;
      }
      return c.id;
    };

    const actorCombatant = (combatants as any[]).find(
      (c) => c.combatantType === "Character" && c.characterId === actorCharacterId,
    );
    if (!actorCombatant) throw new ValidationError("actorId not found in encounter");

    const actorResourcesRaw = actorCombatant.resources ?? {};
    const actorResources = normalizeResources(actorResourcesRaw);
    const actorPos = getPosition(actorResourcesRaw);
    if (!actorPos) throw new ValidationError("actor does not have a position set");

    const actorSpeed = typeof actorResources.speed === "number" ? actorResources.speed : 30;
    const actorDashed = readBoolean(actorResources, "dashed") ?? false;
    const actorMovementSpent = readBoolean(actorResources, "movementSpent") ?? false;
    const actorMovementRemainingRaw = (actorResources as any).movementRemaining;
    const actorMovementRemainingFeet =
      typeof actorMovementRemainingRaw === "number"
        ? actorMovementRemainingRaw
        : actorMovementSpent
          ? 0
          : (actorDashed ? actorSpeed * 2 : actorSpeed);

    const distances = (combatants as any[])
      .filter((c) => c.id !== actorCombatant.id)
      .map((c) => {
        const pos = getPosition(c.resources ?? {});
        const distance = pos ? calculateDistance(actorPos, pos) : null;
        return {
          targetId: c.id,
          targetName: nameFor(c),
          combatantType: c.combatantType,
          position: pos,
          distance,
        };
      })
      .filter((d) => d.distance !== null)
      .sort((a, b) => (a.distance as number) - (b.distance as number))
      .map((d) => ({
        targetId: d.targetId,
        targetName: d.targetName,
        distance: d.distance as number,
        position: d.position,
        combatantType: d.combatantType,
      }));

    // Heuristic OA prediction for questions that mention a destination or target.
    // - If the query contains coordinates like (x, y), predict OA on a straight-line move.
    // - Otherwise, if it references a combatant name, try moving straight to that combatant.
    const coordMatch = query.match(/\((\s*-?\d+(?:\.\d+)?\s*),\s*(-?\d+(?:\.\d+)?\s*)\)/);
    const destinationFromQuery = coordMatch
      ? { x: Number(coordMatch[1]), y: Number(coordMatch[2]) }
      : null;

    const findTargetByName = (q: string): any | null => {
      const qLower = q.toLowerCase();
      for (const c of combatants as any[]) {
        if (c.id === actorCombatant.id) continue;
        const n = nameFor(c).toLowerCase();
        if (n && qLower.includes(n)) return c;
      }
      return null;
    };

    const targetCombatant = destinationFromQuery ? null : findTargetByName(query);
    const destination = destinationFromQuery
      ? destinationFromQuery
      : targetCombatant
        ? getPosition(targetCombatant.resources ?? {})
        : null;

    const oaRisks: Array<{
      combatantId: string;
      combatantName: string;
      reach: number;
      hasReaction: boolean;
      wouldProvoke: boolean;
    }> = [];

    let movementRequiredFeet: number | null = null;
    if (destination) {
      movementRequiredFeet = calculateDistance(actorPos, destination);

      for (const other of combatants as any[]) {
        if (other.id === actorCombatant.id) continue;
        if (other.hpCurrent <= 0) continue;

        const otherResources = normalizeResources(other.resources ?? {});
        const otherPos = getPosition(other.resources ?? {});
        if (!otherPos) continue;

        const reachValue = otherResources.reach;
        const reach = typeof reachValue === "number" ? reachValue : 5;

        const wouldProvoke = crossesThroughReach({ from: actorPos, to: destination }, otherPos, reach);

        const reactionUsed =
          (readBoolean(otherResources, "reactionUsed") ?? false) ||
          (readBoolean(otherResources, "reactionSpent") ?? false);
        const hasReaction = !reactionUsed;

        oaRisks.push({
          combatantId: other.id,
          combatantName: nameFor(other),
          reach,
          hasReaction,
          wouldProvoke,
        });
      }
    }

    const schemaHint = [
      "Return a single JSON object with this shape:",
      "{\n  \"answer\": string\n}",
      "Rules:",
      "- Be concise and tactical.",
      "- Use only numbers provided in the context JSON.",
      "- If asked about attacks/actions/features, use actor.attackOptions and actor.capabilities; do not invent new ones.",
      "- If the question asks for something missing (e.g. unknown destination), say what input is needed.",
    ].join("\n");

    const abilityMod = (score: number): number => Math.floor((score - 10) / 2);

    const actorChar = characterById.get(actorCharacterId);
    const actorSheet = (actorChar?.sheet ?? {}) as any;
    const actorLevel = typeof actorChar?.level === "number" ? actorChar.level : (typeof actorSheet?.level === "number" ? actorSheet.level : 1);
    const actorClassName = typeof actorChar?.className === "string" ? actorChar.className : (typeof actorSheet?.className === "string" ? actorSheet.className : "");
    const isMonk = actorClassName.toLowerCase() === "monk";
    const scores = (actorSheet?.abilityScores ?? {}) as any;
    const str = typeof scores.strength === "number" ? scores.strength : 10;
    const dex = typeof scores.dexterity === "number" ? scores.dexterity : 10;
    const strMod = abilityMod(str);
    const dexMod = abilityMod(dex);
    const chosenAbilityMod = dexMod >= strMod ? dexMod : strMod;
    const profFromSheet = typeof actorSheet?.proficiencyBonus === "number" ? actorSheet.proficiencyBonus : null;
    const proficiencyBonus = profFromSheet ?? (Math.floor((actorLevel - 1) / 4) + 2);

    const unarmedDieSides = isMonk ? getMartialArtsDieSize(actorLevel) : 1;
    const unarmedAttackBonus = proficiencyBonus + chosenAbilityMod;
    const unarmedDamageModifier = isMonk ? chosenAbilityMod : Math.max(0, strMod);
    const unarmedModText = unarmedDamageModifier === 0 ? "" : unarmedDamageModifier > 0 ? `+${unarmedDamageModifier}` : `${unarmedDamageModifier}`;
    const unarmedDamageFormula = `1d${unarmedDieSides}${unarmedModText}`;

    const monkCapabilities = isMonk
      ? [
          {
            name: "Flurry of Blows",
            economy: "bonusAction",
            cost: "1 ki",
            requires: "After you take the Attack action on your turn",
            effect: "Make two Unarmed Strikes",
          },
          {
            name: "Patient Defense",
            economy: "bonusAction",
            cost: "1 ki",
            requires: "On your turn",
            effect: "Take the Dodge action until the start of your next turn",
          },
        ]
      : [];

    const contextForLlm = {
      actor: {
        id: actorCombatant.id,
        name: nameFor(actorCombatant),
        character: characterById.get(actorCharacterId)
          ? {
              id: actorCharacterId,
              name: characterById.get(actorCharacterId)!.name,
              className: characterById.get(actorCharacterId)!.className,
              level: characterById.get(actorCharacterId)!.level,
            }
          : null,
        capabilities: {
          classFeatures: monkCapabilities,
        },
        attackOptions: [
          {
            name: "Unarmed Strike",
            kind: "melee",
            reachFeet: 5,
            attackBonus: unarmedAttackBonus,
            damageFormula: unarmedDamageFormula,
          },
        ],
        position: actorPos,
        speed: actorSpeed,
        movementRemainingFeet: actorMovementRemainingFeet,
        resources: {
          resourcePools: getResourcePools(actorResourcesRaw),
        },
        sheet: characterById.get(actorCharacterId)?.sheet ?? null,
      },
      encounter: {
        id: encounter.id,
        round: encounter.round,
        turn: encounter.turn,
        activeCombatantId: (activeCombatant as any)?.id ?? null,
      },
      distances,
      oaPrediction: {
        destination,
        movementRequiredFeet,
        oaRisks,
      },
    };

    const llmText = [
      "You are answering a player's tactical question about a D&D combat encounter.",
      "Context JSON (authoritative numbers):",
      JSON.stringify(contextForLlm, null, 2),
      "",
      "Question:",
      query,
    ].join("\n");

    const llm = await deps.intentParser.parseIntent({ text: llmText, seed, schemaHint });
    const answer = typeof (llm as any)?.answer === "string" ? (llm as any).answer : "I couldn't generate an answer.";

    return {
      answer,
      context: {
        distances: distances.map((d) => ({
          targetId: d.targetId,
          distance: d.distance,
        })),
        oaPrediction: {
          destination,
          movementRequiredFeet,
          movementRemainingFeet: actorMovementRemainingFeet,
          oaRisks: oaRisks.filter((r) => r.wouldProvoke).map((r) => ({
            combatantId: r.combatantId,
            combatantName: r.combatantName,
            reach: r.reach,
            hasReaction: r.hasReaction,
          })),
        },
      },
    };
  });

  app.get<{
    Params: { id: string; encounterId: string };
  }>("/sessions/:id/combat/:encounterId/combatants", async (req) => {
    const encounterId = req.params.encounterId;
    return deps.combatRepo.listCombatants(encounterId);
  });

  // Tabletop combat flow endpoints
  app.post<{
    Params: { id: string };
    Body: { text: string; actorId: string };
  }>("/sessions/:id/combat/initiate", async (req) => {
    if (!deps.intentParser) throw new ValidationError("LLM intent parser is not configured");
    
    const sessionId = req.params.id;
    const { text, actorId } = req.body;

    if (!text || typeof text !== "string") {
      throw new ValidationError("text is required");
    }
    if (!actorId || typeof actorId !== "string") {
      throw new ValidationError("actorId is required");
    }

    // Parse intent to extract target
    const characters = await deps.characters.listCharacters(sessionId);
    const monsters = await deps.monsters.listBySession(sessionId);
    const npcs = await deps.npcs.listBySession(sessionId);
    
    const roster: LlmRoster = {
      characters: characters.map((c) => ({ id: c.id, name: c.name })),
      monsters: monsters.map((m) => ({ id: m.id, name: m.name })),
      npcs: npcs.map((n) => ({ id: n.id, name: n.name })),
    };

    const intent = await deps.intentParser.parseIntent({
      text,
      schemaHint: buildGameCommandSchemaHint(roster),
    });

    // Try to parse command but don't fail if it's invalid
    // We just need to extract target info if available
    let command: any;
    try {
      command = parseGameCommand(intent);
    } catch {
      // If parsing fails, just use the intent directly
      command = intent;
    }

    // Find or create encounter
    const encounters = await deps.combatRepo.listEncountersBySession(sessionId);
    let encounter = encounters.find((e: any) => e.status === 'Active') ?? encounters[0];
    
    if (!encounter) {
      // Create new encounter
      const encounterId = nanoid();
      encounter = await deps.combatRepo.createEncounter(sessionId, {
        id: encounterId,
        status: 'Pending',
        round: 0,
        turn: 0,
      });
    }

    // Try to extract all targets by matching monster names in text
    // Always use text matching since LLM only returns ONE target even for multi-target attacks
    let intendedTargets: string[] = [];
    const textLower = text.toLowerCase();
    for (const monster of monsters) {
      if (textLower.includes(monster.name.toLowerCase())) {
        intendedTargets.push(monster.id);
      }
    }
    
    // If no matches found via text, try LLM-parsed command
    if (intendedTargets.length === 0 && command?.kind === "attack" && command?.target) {
      const targetId =
        command.target.type === "Character"
          ? command.target.characterId
          : command.target.type === "Monster"
            ? command.target.monsterId
            : command.target.npcId;
      intendedTargets = [targetId];
    }
    
    // For backwards compatibility, use first target if only one
    const intendedTarget = intendedTargets[0];

    // Store pending action
    const pendingAction = {
      type: "INITIATIVE" as const,
      timestamp: new Date(),
      actorId,
      initiator: actorId,
      intendedTarget,
      intendedTargets, // Store all targets for 1vN scenarios
    };

    await deps.combatRepo.setPendingAction(encounter.id, pendingAction);

    return {
      requiresPlayerInput: true,
      type: "REQUEST_ROLL",
      rollType: "initiative",
      message: "Roll for initiative! (d20 + your DEX modifier)",
      diceNeeded: "d20",
      pendingAction,
    };
  });

  app.post<{
    Params: { id: string };
    Body: { text: string; actorId: string };
  }>("/sessions/:id/combat/roll-result", async (req) => {
    try {
      debugLog("=== ROLL RESULT START ===");
      if (debugLogsEnabled) {
        req.log.info({ text: req.body.text, actorId: req.body.actorId }, "Roll result endpoint start");
      }
    
    const sessionId = req.params.id;
    const { text, actorId } = req.body;

    if (!text || typeof text !== "string") {
      throw new ValidationError("text is required");
    }
    if (!actorId || typeof actorId !== "string") {
      throw new ValidationError("actorId is required");
    }

    // Get pending action first to provide context
    const encounters = await deps.combatRepo.listEncountersBySession(sessionId);
    const encounter = encounters.find((e: any) => e.status === 'Pending' || e.status === 'Active') ?? encounters[0];
    
    if (!encounter) {
      throw new ValidationError("No active encounter found");
    }

    const pendingAction = await deps.combatRepo.getPendingAction(encounter.id);
    debugLog("=== GOT PENDING ACTION ===", typeof pendingAction);
    if (debugLogsEnabled) {
      req.log.info({ pendingAction }, "Got pending action");
    }
    
    if (!pendingAction || typeof pendingAction !== 'object') {
      throw new ValidationError("No pending action found");
    }

    const action = pendingAction as any;
    
    // Parse roll result from natural language with context
    const characters = await deps.characters.listCharacters(sessionId);
    const monsters = await deps.monsters.listBySession(sessionId);
    const npcs = await deps.npcs.listBySession(sessionId);
    
    const roster: LlmRoster = {
      characters: characters.map((c) => ({ id: c.id, name: c.name })),
      monsters: monsters.map((m) => ({ id: m.id, name: m.name })),
      npcs: npcs.map((n) => ({ id: n.id, name: n.name })),
    };

    // Build schema hint with expected roll type based on pending action
    let expectedRollType = "initiative";
    if (action.type === "ATTACK") {
      expectedRollType = "attack";
    } else if (action.type === "DAMAGE") {
      expectedRollType = "damage";
    } else if (action.type === "INITIATIVE") {
      expectedRollType = "initiative";
    }

    const contextHint = `\n\nCONTEXT: The player has a pending ${action.type} action. When they say "I rolled X", interpret this as rollType="${expectedRollType}".`;

    // Roll results are intentionally simple in the tabletop flow (e.g. "I rolled a 15").
    // Prefer a deterministic local parse so malformed LLM JSON can't brick combat.
    const numberFromText = (() => {
      const m = text.match(/\b(\d{1,3})\b/);
      if (!m) return null;
      const n = Number(m[1]);
      return Number.isFinite(n) ? n : null;
    })();

    const looksLikeARoll = /\broll(?:ed)?\b/i.test(text);

    let command: any;
    if (looksLikeARoll && numberFromText !== null) {
      command = { kind: "rollResult", value: numberFromText, rollType: expectedRollType };
    } else {
      let intent: unknown;
      try {
        if (!deps.intentParser) {
          // No LLM - try to use the extracted number or fail
          if (numberFromText !== null) {
            command = { kind: "rollResult", value: numberFromText, rollType: expectedRollType };
          } else {
            throw new ValidationError("Could not parse roll value from text and LLM is not configured");
          }
        } else {
          intent = await deps.intentParser.parseIntent({
            text,
            schemaHint: buildGameCommandSchemaHint(roster) + contextHint,
          });
          debugLog("=== PARSED INTENT ===", intent);
          llmDebugLog("Roll Result Intent:", intent);

          try {
            command = parseGameCommand(intent);
            llmDebugLog("Roll Result Command:", command);
          } catch (err) {
            llmDebugLog("Failed to parse roll command, extracting value from intent:", err);
            // Try to extract roll value from intent directly
            command = {
              kind: "rollResult",
              value: (intent as any).value ?? (intent as any).result ?? (intent as any).roll,
              values: (intent as any).values,
              rollType: (intent as any).rollType ?? (intent as any).type,
            };
          }
        }
      } catch (err) {
        // As a last resort, accept a bare number if present.
        if (numberFromText !== null) {
          command = { kind: "rollResult", value: numberFromText, rollType: expectedRollType };
        } else {
          throw err;
        }
      }
    }

    if (command.kind !== "rollResult" && !command.value && !command.values) {
      throw new ValidationError("Expected roll result with numeric value");
    }

    // action and encounter already retrieved above for context

    // Handle initiative roll
    if (action.type === "INITIATIVE" && command.rollType === "initiative") {
      if (debugLogsEnabled) {
        req.log.info({ actionType: action.type, rollType: command.rollType }, "Starting initiative handler");
      }
      const rollValue = command.value ?? (Array.isArray(command.values) ? command.values[0] : 0);
      if (debugLogsEnabled) {
        req.log.info({ rollValue }, "Roll value extracted");
      }
      
      // Get character for DEX modifier
      const character = characters.find(c => c.id === actorId);
      let dexModifier = 0;
      
      if (character && typeof character.sheet === 'object' && character.sheet !== null) {
        const sheet = character.sheet as any;
        if (sheet.abilityScores?.dexterity) {
          dexModifier = Math.floor((sheet.abilityScores.dexterity - 10) / 2);
        }
      }
      
      const finalInitiative = rollValue + dexModifier;

      // Include all session monsters in the encounter.
      // The initiate step only captures intended target(s) from the player's text, but combat should
      // generally include the whole hostile roster (e.g. Quick Encounter spawns 2 goblins).
      const intendedTargetIds: string[] =
        (action as any).intendedTargets ?? (action.intendedTarget ? [action.intendedTarget] : []);
      const allMonsterIds = monsters.map((m) => m.id);
      const targetIds: string[] = [...new Set([...intendedTargetIds, ...allMonsterIds])];
      
      // Start combat with initiatives
      const combatants = [];
      
      // Add player character
      if (character) {
        const sheet = character.sheet as any;
        combatants.push({
          combatantType: "Character" as const,
          characterId: actorId,
          initiative: finalInitiative,
          hpCurrent: sheet?.maxHp ?? 10,
          hpMax: sheet?.maxHp ?? 10,
        });
      }
      
      // Add ALL target monsters
      for (const targetId of targetIds) {
        const monster = monsters.find(m => m.id === targetId);
        if (monster) {
          const statBlock = monster.statBlock as any;
          let monsterInitiative = 10; // Default
          
          if (statBlock.abilityScores?.dexterity) {
            const monsterDexMod = Math.floor((statBlock.abilityScores.dexterity - 10) / 2);
            // Roll for monster (simplified: use average roll of 10)
            monsterInitiative = 10 + monsterDexMod;
          }
          
          combatants.push({
            combatantType: "Monster" as const,
            monsterId: targetId,
            initiative: monsterInitiative,
            hpCurrent: statBlock.hp ?? statBlock.maxHp ?? 10,
            hpMax: statBlock.maxHp ?? statBlock.hp ?? 10,
          });
        }
      }

      // Check if encounter already has combatants (prevent duplicates from multiple /combat/initiate calls)
      const existingCombatants = await deps.combatRepo.listCombatants(encounter.id);
      if (existingCombatants.length > 0) {
        throw new ValidationError("Combat already started - encounter has combatants");
      }

      // Update encounter to Active and add combatants
      debugError("=== BEFORE adding combatants, combatants:", JSON.stringify(combatants));
      if (debugLogsEnabled) {
        req.log.info({ combatants }, "About to add combatants to encounter");
      }
      
      try {
        await deps.combat.addCombatantsToEncounter(sessionId, encounter.id, combatants);
        debugError("=== AFTER adding combatants SUCCESS ===");
        if (debugLogsEnabled) {
          req.log.info({ encounterId: encounter.id }, "Encounter started successfully");
        }
      } catch (err) {
        debugError("=== Adding combatants FAILED ===", err);
        req.log.error({ err, combatants }, "Failed to add combatants");
        throw err;
      }

      // Get combatants to build turn order
      const combatantStates = await deps.combatRepo.listCombatants(encounter.id);
      
      // Build turn order
      const turnOrder = combatantStates.map((c: any) => ({
        actorId: c.characterId || c.monsterId || c.npcId || c.id,
        actorName:
          c.combatantType === "Character"
            ? characters.find(ch => ch.id === c.characterId)?.name ?? "Character"
            : c.combatantType === "Monster"
              ? monsters.find(m => m.id === c.monsterId)?.name ?? "Monster"
              : npcs.find(n => n.id === c.npcId)?.name ?? "NPC",
        initiative: c.initiative ?? 0,
      }));

      const currentTurn = turnOrder[0];

      // Clear pending action
      await deps.combatRepo.clearPendingAction(encounter.id);

      // If a monster acts first, run monster AI immediately so the CLI doesn't have to.
      // (Player will regain control once the AI completes its monster turns.)
      if (deps.aiOrchestrator && currentTurn?.actorId && monsters.some((m) => m.id === currentTurn.actorId)) {
        void deps.aiOrchestrator.processAllMonsterTurns(sessionId, encounter.id).catch((err) => {
          console.error("Error processing monster turns after initiative:", err);
        });
      }

      return {
        rollType: "initiative",
        rawRoll: rollValue,
        modifier: dexModifier,
        total: finalInitiative,
        combatStarted: true,
        encounterId: encounter.id,
        turnOrder,
        currentTurn,
        message: `Combat started! ${currentTurn?.actorName}'s turn (Initiative: ${currentTurn?.initiative}).`,
      };
    }

    // Handle attack roll
    if (action.type === "ATTACK" && command.rollType === "attack") {
      const rollValue = command.value ?? (Array.isArray(command.values) ? command.values[0] : 0);
      
      // Get target for AC
      const targetId = action.targetId || action.target;
      const target =
        monsters.find(m => m.id === targetId) ||
        characters.find(c => c.id === targetId) ||
        npcs.find(n => n.id === targetId);
      
      if (!target) {
        throw new ValidationError("Target not found");
      }

      const targetAC = (target as any).statBlock?.armorClass || (target as any).sheet?.armorClass || 10;
      
      // Get attack bonus from weapon spec
      const attackBonus = action.weaponSpec?.attackBonus ?? 5;
      const total = rollValue + attackBonus;
      const hit = total >= targetAC;

      const attackerRef = { type: "Character" as const, characterId: actorId };
      const targetRef =
        monsters.some((m) => m.id === targetId)
          ? ({ type: "Monster" as const, monsterId: targetId } as const)
          : characters.some((c) => c.id === targetId)
            ? ({ type: "Character" as const, characterId: targetId } as const)
            : ({ type: "NPC" as const, npcId: targetId } as const);

      const attackerName = characters.find((c) => c.id === actorId)?.name ?? "Player";
      const targetName = (target as any)?.name ?? "Target";

      if (deps.events) {
        await deps.events.append(sessionId, {
          id: nanoid(),
          type: "AttackResolved",
          payload: {
            encounterId: encounter.id,
            attacker: attackerRef,
            target: targetRef,
            result: {
              hit,
              critical: rollValue === 20,
              attack: { d20: rollValue, total },
              damage: { applied: 0, roll: { total: 0, rolls: [] } },
            },
          },
        });

        await deps.events.append(sessionId, {
          id: nanoid(),
          type: "NarrativeText",
          payload: {
            encounterId: encounter.id,
            actor: attackerRef,
            text: hit
              ? `${attackerName} strikes ${targetName}!`
              : `${attackerName} swings at ${targetName} but misses.`,
          },
        });
      }

      if (!hit) {
        // Miss - check if this is first strike of Flurry (needs second strike)
        const isFlurryStrike1 = action.bonusAction === "flurry-of-blows" && action.flurryStrike === 1;

        if (isFlurryStrike1) {
          // Prepare second strike even on miss
          const pendingAction2 = {
            type: "ATTACK" as const,
            timestamp: new Date(),
            actorId,
            attacker: actorId,
            target: action.target,
            targetId: action.targetId,
            weaponSpec: action.weaponSpec,
            bonusAction: "flurry-of-blows" as const,
            flurryStrike: 2 as const,
          };

          await deps.combatRepo.setPendingAction(encounter.id, pendingAction2);

          const targetHpRemaining = (target as any).statBlock?.hp ?? (target as any).sheet?.maxHp ?? 0;

          return {
            rawRoll: rollValue,
            modifier: attackBonus,
            total,
            targetAC,
            hit: false,
            targetHpRemaining,
            requiresPlayerInput: true,
            actionComplete: false,
            type: "REQUEST_ROLL",
            rollType: "attack",
            diceNeeded: "d20",
            message: `${rollValue} + ${attackBonus} = ${total} vs AC ${targetAC}. Miss! Second strike: Roll a d20 for attack (no modifiers; server applies bonuses).`,
          };
        }

        // Not Flurry - clear pending action and mark action spent
        await deps.combatRepo.clearPendingAction(encounter.id);

        // Mark the acting combatant's action as spent; player decides when to end turn.
        const combatantStates = await deps.combatRepo.listCombatants(encounter.id);
        const actorCombatant = combatantStates.find((c: any) => c.characterId === actorId);
        if (actorCombatant) {
          const resources = (actorCombatant.resources as any) ?? {};
          await deps.combatRepo.updateCombatantState(actorCombatant.id, {
            resources: { ...resources, actionSpent: true },
          });
        }
        
        const targetHpRemaining = (target as any).statBlock?.hp ?? (target as any).sheet?.maxHp ?? 0;
        
        return {
          rollType: "attack",
          rawRoll: rollValue,
          modifier: attackBonus,
          total,
          targetAC,
          hit: false,
          targetHpRemaining,
          requiresPlayerInput: false,
          actionComplete: true,
          message: `${rollValue} + ${attackBonus} = ${total} vs AC ${targetAC}. Miss!`,
        };
      }

      // Hit - update pending action to request damage roll
      const damageAction = {
        type: "DAMAGE" as const,
        timestamp: new Date(),
        actorId,
        targetId,
        weaponSpec: action.weaponSpec,
        attackRollResult: total,
        bonusAction: action.bonusAction,
        flurryStrike: action.flurryStrike,
      };

      await deps.combatRepo.setPendingAction(encounter.id, damageAction);

      // Return hit result and request damage roll
      return {
        rawRoll: rollValue,
        modifier: attackBonus,
        total,
        targetAC,
        hit: true,
        requiresPlayerInput: true,
        type: "REQUEST_ROLL",
        rollType: "damage",
        diceNeeded: action.weaponSpec?.damageFormula ?? "1d8",
        message: `${rollValue} + ${attackBonus} = ${total} vs AC ${targetAC}. Hit! Roll ${action.weaponSpec?.damageFormula ?? "1d8"} for damage.`,
      };
    }

    // Handle damage roll
    if (action.type === "DAMAGE" && command.rollType === "damage") {
      const rollValue = command.value ?? (Array.isArray(command.values) ? command.values[0] : 0);
      
      // Get target
      const targetId = action.targetId;
      const target =
        monsters.find(m => m.id === targetId) ||
        characters.find(c => c.id === targetId) ||
        npcs.find(n => n.id === targetId);
      
      if (!target) {
        throw new ValidationError("Target not found");
      }

      const parseModifierFromFormula = (formula: unknown): number | null => {
        if (typeof formula !== "string") return null;
        const m = formula.match(/([+-])\s*(\d+)\b/);
        if (!m) return null;
        const sign = m[1] === "-" ? -1 : 1;
        const n = Number(m[2]);
        return Number.isFinite(n) ? sign * n : null;
      };

      const damageModifier =
        typeof action.weaponSpec?.damage?.modifier === "number"
          ? action.weaponSpec.damage.modifier
          : parseModifierFromFormula(action.weaponSpec?.damageFormula) ?? 0;
      const totalDamage = rollValue + damageModifier;

      // Get target HP
      const combatantStates = await deps.combatRepo.listCombatants(encounter.id);
      const targetCombatant = combatantStates.find((c: any) => 
        c.characterId === targetId || c.monsterId === targetId || c.npcId === targetId
      );

      if (targetCombatant) {
        const newHP = Math.max(0, targetCombatant.hpCurrent - totalDamage);
        await deps.combatRepo.updateCombatantState(targetCombatant.id, {
          hpCurrent: newHP,
        });

        const attackerRef = { type: "Character" as const, characterId: actorId };
        const targetRef =
          monsters.some((m) => m.id === targetId)
            ? ({ type: "Monster" as const, monsterId: targetId } as const)
            : characters.some((c) => c.id === targetId)
              ? ({ type: "Character" as const, characterId: targetId } as const)
              : ({ type: "NPC" as const, npcId: targetId } as const);

        const attackerName = characters.find((c) => c.id === actorId)?.name ?? "Player";
        const targetName = (target as any).name ?? "Target";

        if (deps.events) {
          await deps.events.append(sessionId, {
            id: nanoid(),
            type: "DamageApplied",
            payload: {
              encounterId: encounter.id,
              target: targetRef,
              amount: totalDamage,
              hpCurrent: newHP,
            },
          });

          await deps.events.append(sessionId, {
            id: nanoid(),
            type: "NarrativeText",
            payload: {
              encounterId: encounter.id,
              actor: attackerRef,
              text:
                newHP === 0
                  ? `${attackerName} deals ${totalDamage} damage to ${targetName}. ${targetName} falls!`
                  : `${attackerName} deals ${totalDamage} damage to ${targetName}.`,
            },
          });
        }
      }

      // Clear pending action and advance turn
      await deps.combatRepo.clearPendingAction(encounter.id);

      // Check if this was the first strike of Flurry of Blows
      const isFlurryStrike1 = (action as any).bonusAction === "flurry-of-blows" && (action as any).flurryStrike === 1;

      // Mark the acting combatant's action as spent; player decides when to end turn.
      const allCombatants = await deps.combatRepo.listCombatants(encounter.id);
      const actorCombatant = allCombatants.find((c: any) => c.characterId === actorId);
      if (actorCombatant && !isFlurryStrike1) {
        const resources = (actorCombatant.resources as any) ?? {};
        await deps.combatRepo.updateCombatantState(actorCombatant.id, {
          resources: { ...resources, actionSpent: true },
        });
      }

      const targetName = (target as any).name ?? "Target";
      const hpBefore = targetCombatant?.hpCurrent ?? 0;
      const hpAfter = Math.max(0, hpBefore - totalDamage);

      // If this was Flurry of Blows strike 1, prepare strike 2
      if (isFlurryStrike1) {
        const pendingAction2 = {
          type: "ATTACK" as const,
          timestamp: new Date(),
          actorId,
          attacker: actorId,
          target: action.targetId,
          targetId: action.targetId,
          weaponSpec: action.weaponSpec,
          bonusAction: "flurry-of-blows" as const,
          flurryStrike: 2 as const,
        };

        await deps.combatRepo.setPendingAction(encounter.id, pendingAction2);

        return {
          rawRoll: rollValue,
          modifier: damageModifier,
          total: totalDamage,
          totalDamage,
          targetName,
          hpBefore,
          hpAfter,
          targetHpRemaining: hpAfter,
          actionComplete: false,
          requiresPlayerInput: true,
          type: "REQUEST_ROLL",
          rollType: "attack",
          diceNeeded: "d20",
          message: `${rollValue} + ${damageModifier} = ${totalDamage} damage to ${targetName}! HP: ${hpBefore} → ${hpAfter}. Second strike: Roll a d20 for attack (no modifiers; server applies bonuses).`,
        };
      }

      return {
        rollType: "damage",
        rawRoll: rollValue,
        modifier: damageModifier,
        total: totalDamage,
        totalDamage, // Add alias for backwards compat
        targetName,
        hpBefore,
        hpAfter,
        targetHpRemaining: hpAfter, // Add alias
        actionComplete: true,
        requiresPlayerInput: false,
        message: `${rollValue} + ${damageModifier} = ${totalDamage} damage to ${targetName}! HP: ${hpBefore} → ${hpAfter}`,
      };
    }

    // Handle opportunity attack rolls
    if (command.rollType === "opportunity_attack" || command.rollType === "opportunity_attack_damage") {
      const pendingActionId = (req.body as any).pendingActionId;
      if (!pendingActionId) {
        throw new ValidationError("pendingActionId required for OA rolls");
      }

      const pendingAction = await deps.pendingActions.getById(pendingActionId);
      if (!pendingAction || pendingAction.type !== "move") {
        throw new ValidationError("No pending move action found");
      }

      const oaResponse = pendingAction.resolvedReactions.find(
        (r: any) => r.combatantId === actorId && r.choice === "use" && (!r.result || !r.result.attackRoll || (r.result.hit && !r.result.damageRoll))
      );

      if (!oaResponse) {
        throw new ValidationError("No pending OA found for this character");
      }

      if (command.rollType === "opportunity_attack") {
        // Attack roll
        const rollValue = command.value ?? (Array.isArray(command.values) ? command.values[0] : 0);
        
        // Get character for attack bonus
        const character = characters.find(c => c.id === actorId);
        if (!character) throw new NotFoundError("Character not found");

        const str = (character as any).sheet?.abilityScores?.strength ?? 10;
        const dex = (character as any).sheet?.abilityScores?.dexterity ?? 10;
        const strMod = Math.floor((str - 10) / 2);
        const dexMod = Math.floor((dex - 10) / 2);
        const attackBonus = Math.max(strMod, dexMod) + ((character as any).sheet?.proficiencyBonus ?? 2);
        
        const total = rollValue + attackBonus;
        
        // Get target AC
        const moveData = pendingAction.data as any;
        const targetCombatant = (await deps.combatRepo.listCombatants(pendingAction.encounterId))
          .find(c => c.id === (pendingAction.actor as any).characterId || c.id === (pendingAction.actor as any).monsterId);
        
        const targetAC = typeof (targetCombatant?.resources as any)?.armorClass === "number" 
          ? (targetCombatant?.resources as any).armorClass 
          : 10;
        
        const hit = total >= targetAC;

        // Store attack result
        oaResponse.result = {
          attackRoll: rollValue,
          attackTotal: total,
          hit,
        };
        await deps.pendingActions.update(pendingAction);

        if (!hit) {
          // Miss - try to complete movement (will check for more OAs or complete)
          const completeResp = await fetch(`http://localhost:${process.env.PORT || 3001}/sessions/${sessionId}/combat/move/complete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ pendingActionId }),
          });
          return await completeResp.json();
        }

        // Hit - request damage
        return {
          rollType: "opportunity_attack",
          rawRoll: rollValue,
          modifier: attackBonus,
          total,
          targetAC,
          hit: true,
          requiresPlayerInput: true,
          type: "REQUEST_ROLL",
          diceNeeded: "1d8",
          message: `${rollValue} + ${attackBonus} = ${total} vs AC ${targetAC}. Hit! Roll damage.`,
        };
      } else {
        // Damage roll
        const rollValue = command.value ?? (Array.isArray(command.values) ? command.values[0] : 0);
        
        // Get character for damage modifier
        const character = characters.find(c => c.id === actorId);
        if (!character) throw new NotFoundError("Character not found");

        const str = (character as any).sheet?.abilityScores?.strength ?? 10;
        const dex = (character as any).sheet?.abilityScores?.dexterity ?? 10;
        const strMod = Math.floor((str - 10) / 2);
        const dexMod = Math.floor((dex - 10) / 2);
        const damageBonus = Math.max(strMod, dexMod);
        
        const totalDamage = rollValue + damageBonus;

        // Store damage result
        if (oaResponse.result) {
          oaResponse.result.damageRoll = rollValue;
          oaResponse.result.damageTotal = totalDamage;
          await deps.pendingActions.update(pendingAction);
        }

        // Try to complete movement (will check for more OAs or complete)
        const completeResp = await fetch(`http://localhost:${process.env.PORT || 3001}/sessions/${sessionId}/combat/move/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pendingActionId }),
        });
        return await completeResp.json();
      }
    }

    // Other roll types not yet implemented
    throw new ValidationError(`Roll type ${command.rollType} not yet implemented for action type ${action.type}`);
    } catch (err) {
      console.error("Roll result endpoint error:", err);
      console.error("Stack:", (err as Error).stack);
      req.log.error({ err, stack: (err as Error).stack }, "Roll result endpoint error");
      throw err;
    }
  });

  app.post<{
    Params: { id: string };
    Body: { text: string; actorId: string; encounterId: string };
  }>("/sessions/:id/combat/action", async (req) => {
    const sessionId = req.params.id;
    const { text, actorId, encounterId } = req.body;

    if (!text || typeof text !== "string") {
      throw new ValidationError("text is required");
    }
    if (!actorId || typeof actorId !== "string") {
      throw new ValidationError("actorId is required");
    }
    if (!encounterId || typeof encounterId !== "string") {
      throw new ValidationError("encounterId is required");
    }

    const tryParseMoveText = (input: string): { x: number; y: number } | null => {
      // Accept: "move to (35, 25)", "move to 35 25", "move (35,25)", "move 35,25"
      const normalized = input.trim().toLowerCase();
      if (!normalized.startsWith("move")) return null;

      const match = normalized.match(/move\s*(?:to\s*)?\(?\s*(-?\d+)\s*[ ,]\s*(-?\d+)\s*\)?/);
      if (!match) return null;
      const x = Number.parseInt(match[1]!, 10);
      const y = Number.parseInt(match[2]!, 10);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return { x, y };
    };

    const abilityMod = (score: number): number => Math.floor((score - 10) / 2);

    const tryParseSimpleActionText = (input: string): "dash" | "dodge" | "disengage" | null => {
      const normalized = input.trim().toLowerCase();
      if (/\b(dash)\b/.test(normalized)) return "dash";
      if (/\b(dodge)\b/.test(normalized)) return "dodge";
      if (/\b(disengage)\b/.test(normalized)) return "disengage";
      return null;
    };

    const tryParseBonusActionText = (input: string): "flurry-of-blows" | "patient-defense" | "step-of-the-wind" | null => {
      const normalized = input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
      if (/flurry|flurryofblows/.test(normalized)) return "flurry-of-blows";
      if (/patientdefense/.test(normalized)) return "patient-defense";
      if (/stepofthewind/.test(normalized)) return "step-of-the-wind";
      return null;
    };

    const inferActorRef = (id: string, roster: LlmRoster) => {
      if (roster.characters.some((c) => c.id === id)) return { type: "Character" as const, characterId: id };
      if (roster.monsters.some((m) => m.id === id)) return { type: "Monster" as const, monsterId: id };
      if (roster.npcs.some((n) => n.id === id)) return { type: "NPC" as const, npcId: id };
      throw new ValidationError(`actorId not found in roster: ${id}`);
    };

    // Parse combat action intent
    const characters = await deps.characters.listCharacters(sessionId);
    const monsters = await deps.monsters.listBySession(sessionId);
    const npcs = await deps.npcs.listBySession(sessionId);
    
    const roster: LlmRoster = {
      characters: characters.map((c) => ({ id: c.id, name: c.name })),
      monsters: monsters.map((m) => ({ id: m.id, name: m.name })),
      npcs: npcs.map((n) => ({ id: n.id, name: n.name })),
    };

    let command: any;
    const directMove = tryParseMoveText(text);
    const directSimple = directMove ? null : tryParseSimpleActionText(text);
    const directBonus = (directMove || directSimple) ? null : tryParseBonusActionText(text);

    if (directMove) {
      command = {
        kind: "move",
        encounterId,
        actor: inferActorRef(actorId, roster),
        destination: directMove,
      };
    } else if (directSimple) {
      const actor = inferActorRef(actorId, roster);
      if (directSimple === "dash") {
        await deps.actions.dash(sessionId, { encounterId, actor });
        return {
          requiresPlayerInput: false,
          actionComplete: true,
          type: "SIMPLE_ACTION_COMPLETE",
          action: "Dash",
          message: "Dashed.",
        };
      }
      if (directSimple === "dodge") {
        await deps.actions.dodge(sessionId, { encounterId, actor });
        return {
          requiresPlayerInput: false,
          actionComplete: true,
          type: "SIMPLE_ACTION_COMPLETE",
          action: "Dodge",
          message: "Dodged.",
        };
      }
      if (directSimple === "disengage") {
        await deps.actions.disengage(sessionId, { encounterId, actor });
        return {
          requiresPlayerInput: false,
          actionComplete: true,
          type: "SIMPLE_ACTION_COMPLETE",
          action: "Disengage",
          message: "Disengaged.",
        };
      }
    } else if (directBonus) {
      // Deterministic bonus actions (Flurry of Blows, etc.)
      if (directBonus === "flurry-of-blows") {
        const actorChar = characters.find((c) => c.id === actorId);
        const actorSheet = (actorChar?.sheet ?? {}) as any;
        const actorLevel = typeof actorChar?.level === "number" ? actorChar.level : (typeof actorSheet?.level === "number" ? actorSheet.level : 1);
        const actorClassName = typeof actorChar?.className === "string" ? actorChar.className : (typeof actorSheet?.className === "string" ? actorSheet.className : "");
        const isMonk = actorClassName.toLowerCase() === "monk";

        if (!isMonk || actorLevel < 2) {
          throw new ValidationError("Flurry of Blows requires Monk level 2+");
        }

        // Infer target from text (look for monster names)
        let inferredTarget: string | null = null;
        for (const m of monsters) {
          if (text.toLowerCase().includes(m.name.toLowerCase())) {
            inferredTarget = m.id;
            break;
          }
        }

        if (!inferredTarget) {
          // Find nearest alive hostile
          const combatantStates = await deps.combatRepo.listCombatants(encounterId);
          const actorCombatant = combatantStates.find((c: any) => c.combatantType === "Character" && c.characterId === actorId);
          if (!actorCombatant) throw new ValidationError("Actor not found in encounter");

          const actorPos = getPosition(actorCombatant.resources ?? {});
          if (!actorPos) throw new ValidationError("Actor has no position");

          const hostiles = combatantStates.filter((c: any) => c.combatantType === "Monster" && c.hpCurrent > 0);
          if (hostiles.length === 0) throw new ValidationError("No valid targets available");

          let nearest = hostiles[0];
          let minDist = 9999;
          for (const h of hostiles) {
            const hPos = getPosition(h.resources ?? {});
            if (!hPos) continue;
            const d = calculateDistance(actorPos, hPos);
            if (d < minDist) {
              minDist = d;
              nearest = h;
            }
          }
          inferredTarget = nearest.monsterId!;
        }

        const target = monsters.find(m => m.id === inferredTarget);
        if (!target) throw new ValidationError("Target not found");

        // Validate reach (Flurry is unarmed = melee = 5ft reach)
        const combatantStates = await deps.combatRepo.listCombatants(encounterId);
        const actorCombatant = combatantStates.find((c: any) => c.combatantType === "Character" && c.characterId === actorId);
        const targetCombatant = combatantStates.find((c: any) => c.monsterId === inferredTarget);
        if (!actorCombatant || !targetCombatant) throw new ValidationError("Combatants not found");

        const actorPos = getPosition(actorCombatant.resources ?? {});
        const targetPos = getPosition(targetCombatant.resources ?? {});
        if (!actorPos || !targetPos) throw new ValidationError("Positions not set");

        const dist = calculateDistance(actorPos, targetPos);
        if (!(dist <= 5 + 0.0001)) {
          throw new ValidationError(`Target is out of reach (${Math.round(dist)}ft > 5ft)`);
        }

        // Compute monk unarmed strike stats
        const scores = (actorSheet?.abilityScores ?? {}) as any;
        const str = typeof scores.strength === "number" ? scores.strength : 10;
        const dex = typeof scores.dexterity === "number" ? scores.dexterity : 10;
        const strMod = abilityMod(str);
        const dexMod = abilityMod(dex);
        const chosenAbilityMod = dexMod >= strMod ? dexMod : strMod;

        const profFromSheet = typeof actorSheet?.proficiencyBonus === "number" ? actorSheet.proficiencyBonus : null;
        const proficiencyBonus = profFromSheet ?? (Math.floor((actorLevel - 1) / 4) + 2);

        const unarmedDieSides = getMartialArtsDieSize(actorLevel);
        const unarmedDamageModifier = chosenAbilityMod;
        const unarmedAttackBonus = proficiencyBonus + chosenAbilityMod;

        const modText = unarmedDamageModifier === 0 ? "" : unarmedDamageModifier > 0 ? `+${unarmedDamageModifier}` : `${unarmedDamageModifier}`;
        const damageFormula = `1d${unarmedDieSides}${modText}`;

        const weaponSpec = {
          name: "Flurry of Blows (Unarmed Strike)",
          kind: "melee" as const,
          attackBonus: unarmedAttackBonus,
          damage: { diceCount: 1, diceSides: unarmedDieSides, modifier: unarmedDamageModifier },
          damageFormula,
        };

        // Create pending action for first strike
        const pendingAction = {
          type: "ATTACK" as const,
          timestamp: new Date(),
          actorId,
          attacker: actorId,
          target: inferredTarget,
          targetId: inferredTarget,
          weaponSpec,
          bonusAction: "flurry-of-blows" as const,
          flurryStrike: 1 as const,
        };

        await deps.combatRepo.setPendingAction(encounterId, pendingAction);

        return {
          requiresPlayerInput: true,
          type: "REQUEST_ROLL",
          rollType: "attack",
          message: `Roll a d20 for attack against ${target.name} (no modifiers; server applies bonuses).`,
          diceNeeded: "d20",
          pendingAction,
        };
      }
    } else {
      if (!deps.intentParser) throw new ValidationError("LLM intent parser is not configured");

      const intent = await deps.intentParser.parseIntent({
        text,
        schemaHint: buildGameCommandSchemaHint(roster),
      });
      llmDebugLog("Action Intent:", intent);

      try {
        command = parseGameCommand(intent);
        llmDebugLog("Action Command:", command);
      } catch (err) {
        llmDebugLog("Failed to parse action command:", err);
        throw new ValidationError(`Could not parse combat action: ${(err as Error).message}`);
      }
    }

    if (command.kind === "move") {
      const actorRef = command.actor;
      const destination = command.destination;

      const moveInit = await deps.twoPhaseActions.initiateMove(sessionId, {
        encounterId,
        actor: actorRef,
        destination,
      });

      if (moveInit.status === "no_reactions") {
        const combatantStates = await deps.combatRepo.listCombatants(encounterId);
        const actorState = combatantStates.find((c: any) => {
          if (actorRef.type === "Character") return c.characterId === actorRef.characterId;
          if (actorRef.type === "Monster") return c.monsterId === actorRef.monsterId;
          return c.npcId === actorRef.npcId;
        });
        if (!actorState) throw new ValidationError("Actor not found in encounter");

        const resources = (actorState.resources as any) ?? {};
        const currentPos = resources.position;
        await deps.combatRepo.updateCombatantState(actorState.id, {
          resources: {
            ...resources,
            position: destination,
            movementSpent: true,
          } as any,
        });

        const movedFeet = currentPos ? calculateDistance(currentPos, destination) : null;

        return {
          requiresPlayerInput: false,
          actionComplete: true,
          type: "MOVE_COMPLETE",
          movedTo: destination,
          movedFeet,
          opportunityAttacks: moveInit.opportunityAttacks,
          message: `Moved to (${destination.x}, ${destination.y})${movedFeet !== null ? ` (${Math.round(movedFeet)}ft)` : ""}.`,
        };
      }

      return {
        requiresPlayerInput: false,
        actionComplete: false,
        type: "REACTION_CHECK",
        pendingActionId: moveInit.pendingActionId,
        opportunityAttacks: moveInit.opportunityAttacks,
        message: "Opportunity attacks possible. Resolve reactions, then complete the move.",
      };
    }

    // Handle attack action
    if (command.kind === "attack") {
      const targetId = command.target
        ? command.target.type === "Character"
          ? command.target.characterId
          : command.target.type === "Monster"
            ? command.target.monsterId
            : command.target.npcId
        : undefined;
      const target =
        monsters.find(m => m.id === targetId) ||
        characters.find(c => c.id === targetId) ||
        npcs.find(n => n.id === targetId);
      
      if (!target) {
        throw new ValidationError("Target not found");
      }

      const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null;

      // Determine actor + target positions (tabletop requires position + reach checks for melee).
      const combatantStates = await deps.combatRepo.listCombatants(encounterId);
      const actorCombatant = combatantStates.find((c: any) => c.combatantType === "Character" && c.characterId === actorId);
      if (!actorCombatant) throw new ValidationError("Actor not found in encounter");

      const targetCombatant = combatantStates.find((c: any) => c.monsterId === targetId || c.characterId === targetId || c.npcId === targetId);
      if (!targetCombatant) throw new ValidationError("Target not found in encounter");

      const actorPos = getPosition(actorCombatant.resources ?? {});
      const targetPos = getPosition(targetCombatant.resources ?? {});
      if (!actorPos || !targetPos) throw new ValidationError("Actor and target must have positions set");

      const lowered = text.toLowerCase();
      const spec = (command as any).spec as unknown;
      const specKind = isRecord(spec) && typeof (spec as any).kind === "string" ? (spec as any).kind : undefined;

      const inferredKind: "melee" | "ranged" =
        /\b(bow|shortbow|longbow|shoot|arrow|ranged)\b/.test(lowered)
          ? "ranged"
          : /\b(unarmed|fist|punch|kick)\b/.test(lowered)
            ? "melee"
            : (specKind === "ranged" ? "ranged" : "melee");

      if (inferredKind === "melee") {
        const actorResources = normalizeResources(actorCombatant.resources ?? {});
        const reachValue = (actorResources as any).reach;
        const reach = typeof reachValue === "number" ? reachValue : 5;
        const dist = calculateDistance(actorPos, targetPos);
        if (!(dist <= reach + 0.0001)) {
          throw new ValidationError(`Target is out of reach (${Math.round(dist)}ft > ${Math.round(reach)}ft)`);
        }
      }

      // Determine weapon spec.
      // For Character attackers, the schema requires spec (attack bonus + damage dice).
      const specDamage = isRecord(spec) ? (spec as any).damage : undefined;

      const actorChar = characters.find((c) => c.id === actorId);
      const actorSheet = (actorChar?.sheet ?? {}) as any;
      const actorLevel = typeof actorChar?.level === "number" ? actorChar.level : (typeof actorSheet?.level === "number" ? actorSheet.level : 1);
      const actorClassName = typeof actorChar?.className === "string" ? actorChar.className : (typeof actorSheet?.className === "string" ? actorSheet.className : "");
      const isMonk = actorClassName.toLowerCase() === "monk";

      const scores = (actorSheet?.abilityScores ?? {}) as any;
      const str = typeof scores.strength === "number" ? scores.strength : 10;
      const dex = typeof scores.dexterity === "number" ? scores.dexterity : 10;
      const strMod = abilityMod(str);
      const dexMod = abilityMod(dex);
      const chosenAbilityMod = dexMod >= strMod ? dexMod : strMod;

      const profFromSheet = typeof actorSheet?.proficiencyBonus === "number" ? actorSheet.proficiencyBonus : null;
      const proficiencyBonus = profFromSheet ?? (Math.floor((actorLevel - 1) / 4) + 2);

      const isUnarmed = /\b(unarmed|fist|punch|kick)\b/.test(lowered);

      const diceCount = typeof specDamage?.diceCount === "number" ? specDamage.diceCount : 1;
      const diceSidesRaw = typeof specDamage?.diceSides === "number" ? specDamage.diceSides : 8;
      const modifierRaw = typeof specDamage?.modifier === "number" ? specDamage.modifier : chosenAbilityMod;
      const attackBonusRaw = isRecord(spec) && typeof (spec as any).attackBonus === "number" ? (spec as any).attackBonus : proficiencyBonus + chosenAbilityMod;

      // Do not trust LLM for unarmed strike stats. Compute deterministically.
      const unarmedDieSides = isMonk ? getMartialArtsDieSize(actorLevel) : 1;
      const unarmedDamageModifier = isMonk ? chosenAbilityMod : Math.max(0, strMod);
      const unarmedAttackBonus = proficiencyBonus + chosenAbilityMod;

      const finalDiceSides = isUnarmed ? unarmedDieSides : diceSidesRaw;
      const finalModifier = isUnarmed ? unarmedDamageModifier : modifierRaw;
      const finalAttackBonus = isUnarmed ? unarmedAttackBonus : (Number.isFinite(attackBonusRaw) && attackBonusRaw > 0 ? attackBonusRaw : (proficiencyBonus + chosenAbilityMod));

      const modText = finalModifier === 0 ? "" : finalModifier > 0 ? `+${finalModifier}` : `${finalModifier}`;
      const damageFormula = `${diceCount}d${finalDiceSides}${modText}`;
      const name = isUnarmed ? "Unarmed Strike" : "Attack";

      const weaponSpec = {
        name,
        kind: inferredKind,
        attackBonus: finalAttackBonus,
        damage: { diceCount, diceSides: finalDiceSides, modifier: finalModifier },
        damageFormula,
      };

      // Check for advantage/disadvantage
      // Detect prone condition from target name (simplified - would check actual conditions in full implementation)
      const targetName = (target as any).name?.toLowerCase() || "";
      const targetIsProne = targetName.includes("prone");
      const advantage = targetIsProne; // Melee attacks have advantage against prone targets
      const disadvantage = false;

      // Create pending action
      const pendingAction = {
        type: "ATTACK" as const,
        timestamp: new Date(),
        actorId,
        attacker: actorId,
        target: targetId,
        targetId,
        weaponSpec,
      };

      await deps.combatRepo.setPendingAction(encounterId, pendingAction);

      // Request attack roll
      return {
        requiresPlayerInput: true,
        type: "REQUEST_ROLL",
        rollType: "attack",
        message: advantage 
          ? `Roll for attack with advantage! Roll 2d20 and tell me both results.`
          : `Roll a d20 for attack against ${(target as any).name} (no modifiers; server applies bonuses).`,
        diceNeeded: advantage ? "2d20" : "d20",
        advantage,
        disadvantage,
        pendingAction,
      };
    }

    throw new ValidationError(`Action type ${command.kind} not yet implemented`);
  });

  app.post<{
    Params: { id: string };
    Body: { pendingActionId: string };
  }>("/sessions/:id/combat/move/complete", async (req) => {
    const sessionId = req.params.id;
    await deps.sessions.getSessionOrThrow(sessionId);

    const pendingActionId = req.body?.pendingActionId;
    if (!pendingActionId || typeof pendingActionId !== "string") {
      throw new ValidationError("pendingActionId is required");
    }

    // Check if any player character OAs need rolls before completing movement
    const pendingAction = await deps.pendingActions.getById(pendingActionId);
    if (!pendingAction) {
      throw new NotFoundError(`Pending action not found: ${pendingActionId}`);
    }

    // Find player OAs that need attack or damage rolls
    const combatants = await deps.combatRepo.listCombatants(pendingAction.encounterId);
    const playerOAsAwaitingRolls = pendingAction.resolvedReactions
      .filter((r: any) => r.choice === "use")
      .filter((r: any) => {
        const combatant = combatants.find(c => c.id === r.combatantId);
        return combatant?.combatantType === "Character";
      })
      .filter((r: any) => !r.result || !r.result.attackRoll); // Need attack roll (or hasn't rolled yet)

    if (playerOAsAwaitingRolls.length > 0) {
      const nextOA = playerOAsAwaitingRolls[0] as any;
      const combatant = combatants.find(c => c.id === nextOA.combatantId);
      const characters = await deps.combatRepo.listCombatants(pendingAction.encounterId);
      const charRecord = characters.find(c => c.id === nextOA.combatantId && c.combatantType === "Character");
      const combatantName = charRecord?.characterId
        ? "Character" // TODO: Get actual name from character service
        : "Character";

      // Check if we need attack or damage roll
      const needsDamage = nextOA.result?.hit === true && !nextOA.result.damageRoll;
      
      if (needsDamage) {
        // Already hit, need damage roll
        return {
          requiresPlayerInput: true,
          type: "REQUEST_ROLL",
          rollType: "opportunity_attack_damage",
          pendingActionId,
          combatantId: nextOA.combatantId,
          diceNeeded: "1d8", // TODO: Get from character's weapon
          message: `${combatantName}'s opportunity attack hit! Roll damage.`,
        };
      } else {
        // Need attack roll
        return {
          requiresPlayerInput: true,
          type: "REQUEST_ROLL",
          rollType: "opportunity_attack",
          pendingActionId,
          combatantId: nextOA.combatantId,
          diceNeeded: "d20",
          message: `${combatantName} gets an opportunity attack! Roll d20.`,
        };
      }
    }

    const result = await deps.twoPhaseActions.completeMove(sessionId, { pendingActionId });

    // Clear pending action from encounter now that move is complete
    await deps.combatRepo.clearPendingAction(pendingAction.encounterId);

    // If this was a Monster/NPC move that paused for player OA, advance turn after move completes
    // (Player moves handle turn advancement differently via explicit endTurn action)
    const actorCombatant = (await deps.combatRepo.listCombatants(pendingAction.encounterId))
      .find(c => 
        (pendingAction.actor.type === 'Character' && c.characterId === (pendingAction.actor as any).characterId) ||
        (pendingAction.actor.type === 'Monster' && c.monsterId === (pendingAction.actor as any).monsterId) ||
        (pendingAction.actor.type === 'NPC' && c.npcId === (pendingAction.actor as any).npcId)
      );

    const isMonsterOrNpc = actorCombatant && (actorCombatant.combatantType === 'Monster' || actorCombatant.combatantType === 'NPC');
    
    if (isMonsterOrNpc && deps.combat) {
      // Advance turn (Monster AI action is complete)
      await deps.combat.nextTurn(sessionId, { encounterId: pendingAction.encounterId });
      
      // Process next Monster AI turn if any
      if (deps.aiOrchestrator) {
        void deps.aiOrchestrator.processAllMonsterTurns(sessionId, pendingAction.encounterId).catch((err) => {
          console.error("Error processing next monster turn after OA resolution:", err);
        });
      }
    }

    return {
      success: true,
      actionComplete: true,
      ...result,
      message: `Movement complete. Now at (${result.to.x}, ${result.to.y}).`,
    };
  });

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
          void deps.aiOrchestrator.processAllMonsterTurns(sessionId, req.body.encounterId).catch((err) => {
            console.error("Error processing monster turns after endTurn:", err);
          });
        }

        return result;
      }

      const result = await deps.combat.endTurn(sessionId, input);

      if (deps.aiOrchestrator && typeof req.body.encounterId === "string") {
        void deps.aiOrchestrator.processAllMonsterTurns(sessionId, req.body.encounterId).catch((err) => {
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

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    "/sessions/:id/events",
    async (req, reply) => {
      const sessionId = req.params.id;

      // SSE headers
      reply.raw.setHeader("Content-Type", "text/event-stream");
      reply.raw.setHeader("Cache-Control", "no-cache");
      reply.raw.setHeader("Connection", "keep-alive");
      reply.raw.setHeader("X-Accel-Buffering", "no");
      reply.raw.setHeader("Access-Control-Allow-Origin", "*");

      if (typeof reply.raw.flushHeaders === "function") {
        reply.raw.flushHeaders();
      }

      reply.raw.write(": connected\n\n");

      const limit = req.query.limit ? Number(req.query.limit) : 50;
      const backlog = await deps.events.listBySession(sessionId, { limit });
      for (const ev of backlog) {
        const payload = JSON.stringify({ type: ev.type, payload: ev.payload, createdAt: ev.createdAt });
        reply.raw.write(`event: ${ev.type}\n`);
        reply.raw.write(`data: ${payload}\n\n`);
      }

      const heartbeat = setInterval(() => {
        try {
          reply.raw.write(": ping\n\n");
        } catch {
          // ignore
        }
      }, 15000);

      const unsubscribe = app.sseBroker.subscribe(sessionId, (event) => {
        const payload = JSON.stringify(event);
        reply.raw.write(`event: ${event.type}\n`);
        reply.raw.write(`data: ${payload}\n\n`);
      });

      req.raw.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
      });

      return reply;
    },
  );

  // JSON endpoint for getting events (for testing)
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    "/sessions/:id/events-json",
    async (req, reply) => {
      const sessionId = req.params.id;
      if (debugLogsEnabled) {
        app.log.info({ sessionId }, "Getting events as JSON");
      }
      
      const limit = req.query.limit ? Number(req.query.limit) : 50;
      const events = await deps.events.listBySession(sessionId, { limit });
      
      if (debugLogsEnabled) {
        app.log.info({ sessionId, eventCount: events.length }, "Returning events");
      }
      return events;
    },
  );
}
