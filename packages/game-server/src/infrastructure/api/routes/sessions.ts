import type { FastifyInstance } from "fastify";

import type { ActionService } from "../../../application/services/combat/action-service.js";
import type { CharacterService } from "../../../application/services/entities/character-service.js";
import type { CombatService } from "../../../application/services/combat/combat-service.js";
import type { GameSessionService } from "../../../application/services/entities/game-session-service.js";
import type { MonsterAIService } from "../../../application/services/combat/ai/monster-ai-service.js";
import type { IEventRepository } from "../../../application/repositories/event-repository.js";
import type { IMonsterRepository } from "../../../application/repositories/monster-repository.js";
import type { INPCRepository } from "../../../application/repositories/npc-repository.js";
import type { ICombatRepository } from "../../../application/repositories/combat-repository.js";
import { ValidationError } from "../../../application/errors.js";
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

export function registerSessionRoutes(
  app: FastifyInstance,
  deps: {
    sessions: GameSessionService;
    characters: CharacterService;
    combat: CombatService;
    actions: ActionService;
    monsterAI?: MonsterAIService;
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
      monsterAI: MonsterAIService;
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
      storyFramework = await deps.storyGenerator.generateStoryFramework({ seed: req.body?.storySeed });
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
      if (!deps.intentParser) throw new ValidationError("LLM intent parser is not configured");
    
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

      // Get all targets and roll initiative for them too
      const targetIds: string[] = (action as any).intendedTargets ?? (action.intendedTarget ? [action.intendedTarget] : []);
      
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
        // Miss - clear pending action, advance turn, and trigger monster AI
        await deps.combatRepo.clearPendingAction(encounter.id);
        await deps.combat.nextTurn(sessionId, { encounterId: encounter.id });
        
        const targetHpRemaining = (target as any).statBlock?.hp ?? (target as any).sheet?.maxHp ?? 0;
        
        // Process monster turns after player action completes
        if (deps.monsterAI) {
          void deps.monsterAI.processAllMonsterTurns(sessionId, encounter.id).catch(err => {
            console.error("Error processing monster turns after miss:", err);
          });
        }
        
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

      // Calculate damage modifier (simplified - would get from character STR/DEX)
      const damageModifier = 3; // Simplified
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
      await deps.combat.nextTurn(sessionId, { encounterId: encounter.id });

      const targetName = (target as any).name ?? "Target";
      const hpBefore = targetCombatant?.hpCurrent ?? 0;
      const hpAfter = Math.max(0, hpBefore - totalDamage);

      // Process monster turns after player action completes
      if (deps.monsterAI) {
        // Run in background to not block response
        void deps.monsterAI.processAllMonsterTurns(sessionId, encounter.id).catch(err => {
          console.error("Error processing monster turns:", err);
        });
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
    if (!deps.intentParser) throw new ValidationError("LLM intent parser is not configured");
    
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

    // Parse combat action intent
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
    llmDebugLog("Action Intent:", intent);

    let command: any;
    try {
      command = parseGameCommand(intent);
      llmDebugLog("Action Command:", command);
    } catch (err) {
      llmDebugLog("Failed to parse action command:", err);
      throw new ValidationError(`Could not parse combat action: ${(err as Error).message}`);
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

      // Get attacker details for weapon spec (simplified)
      const attacker = characters.find(c => c.id === actorId) || monsters.find(m => m.id === actorId);
      
      // Determine weapon spec (simplified - would get from character sheet)
      const weaponSpec = {
        name: "Weapon",
        attackBonus: 5, // Would calculate from character stats
        damageFormula: "1d8+3", // Would get from weapon
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
          : `Roll d20 for attack against ${(target as any).name}!`,
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

        if (deps.monsterAI && typeof req.body.encounterId === "string") {
          void deps.monsterAI.processAllMonsterTurns(sessionId, req.body.encounterId).catch((err) => {
            console.error("Error processing monster turns after endTurn:", err);
          });
        }

        return result;
      }

      const result = await deps.combat.endTurn(sessionId, input);

      if (deps.monsterAI && typeof req.body.encounterId === "string") {
        void deps.monsterAI.processAllMonsterTurns(sessionId, req.body.encounterId).catch((err) => {
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
