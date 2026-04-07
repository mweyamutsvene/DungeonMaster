import Fastify, { type FastifyInstance } from "fastify";

import {
  ActionService,
  CharacterService,
  CombatService,
  GameSessionService,
  ItemLookupService,
  TacticalViewService,
  TabletopCombatService,
} from "../../application/services/index.js";
import { AiTurnOrchestrator } from "../../application/services/combat/ai/index.js";
import { FactionService } from "../../application/services/combat/helpers/faction-service.js";
import { CombatantResolver } from "../../application/services/combat/helpers/combatant-resolver.js";
import { BasicCombatVictoryPolicy } from "../../application/services/combat/combat-victory-policy.js";
import { AbilityRegistry } from "../../application/services/combat/abilities/ability-registry.js";
import { 
  ActionSurgeExecutor,
  IndomitableExecutor,
  SecondWindExecutor,
  NimbleEscapeExecutor, 
  CunningActionExecutor, 
  OffhandAttackExecutor, 
  FlurryOfBlowsExecutor, 
  PatientDefenseExecutor, 
  StepOfTheWindExecutor, 
  MartialArtsExecutor,
  WholenessOfBodyExecutor,
  RageExecutor,
  RecklessAttackExecutor,
  BrutalStrikeExecutor,
  LayOnHandsExecutor,
  TurnUndeadExecutor,
} from "../../application/services/combat/abilities/executors/index.js";
import { TwoPhaseActionService } from "../../application/services/combat/two-phase-action-service.js";
import { InMemoryPendingActionRepository } from "../testing/memory-repos.js";
import { PrismaPendingActionRepository } from "../db/pending-action-repository.js";
import type { PendingActionRepository } from "../../application/repositories/pending-action-repository.js";
import type {
  ICharacterRepository,
  ICombatRepository,
  IEventRepository,
  IGameSessionRepository,
  IItemDefinitionRepository,
  IMonsterRepository,
  INPCRepository,
  ISpellRepository,
} from "../../application/repositories/index.js";

import { registerHealthRoutes } from "./routes/health.js";
import { registerSessionRoutes } from "./routes/sessions/index.js";
import { registerReactionRoutes } from "./routes/reactions.js";
import { registerCatalogRoutes } from "./routes/catalog.js";
import { sseBroker } from "./realtime/sse-broker.js";
import { NotFoundError, ValidationError } from "../../application/errors.js";
import type { PrismaUnitOfWork } from "../db/unit-of-work.js";
import type { PrismaClient } from "@prisma/client";
import type { IStoryGenerator } from "../llm/story-generator.js";
import type { IIntentParser } from "../llm/intent-parser.js";
import type { INarrativeGenerator } from "../llm/narrative-generator.js";
import type { ICharacterGenerator } from "../llm/character-generator.js";
import type { IAiDecisionMaker } from "../../application/services/combat/ai/ai-types.js";
import { LlmAiDecisionMaker } from "../llm/ai-decision-maker.js";
import { LlmBattlePlanner } from "../llm/battle-planner.js";
import { BattlePlanService } from "../../application/services/combat/ai/battle-plan-service.js";
import type { LlmProvider } from "../llm/types.js";
import { type DiceRoller, RandomDiceRoller } from "../../domain/rules/dice-roller.js";

export type AppDeps = {
  sessionsRepo: IGameSessionRepository;
  charactersRepo: ICharacterRepository;
  monstersRepo: IMonsterRepository;
  npcsRepo: INPCRepository;
  combatRepo: ICombatRepository;
  eventsRepo: IEventRepository;
  spellsRepo: ISpellRepository;
  itemDefinitionsRepo?: IItemDefinitionRepository;
  unitOfWork?: PrismaUnitOfWork;
  /** Raw Prisma client for read-only catalog queries (monster definitions, etc.). Optional — omit in tests. */
  prismaClient?: PrismaClient;
  storyGenerator?: IStoryGenerator;
  intentParser?: IIntentParser;
  narrativeGenerator?: INarrativeGenerator;
  characterGenerator?: ICharacterGenerator;
  aiDecisionMaker?: IAiDecisionMaker;
  llmProvider?: LlmProvider;
  llmConfig?: { model: string; temperature?: number; timeoutMs?: number };
  diceRoller?: DiceRoller;
  /**
   * Fastify logger configuration.
   * - `false` disables Fastify's built-in request logging.
   * - `{ level }` sets the pino level.
   * Defaults to quieter logging in tests.
   */
  logger?: false | true | { level: "fatal" | "error" | "warn" | "info" | "debug" | "trace" };
};

declare module "fastify" {
  interface FastifyInstance {
    sseBroker: typeof sseBroker;
  }
}

/**
 * Endpoints that generate noisy logs during polling - suppress their request logging
 */
const QUIET_ENDPOINTS = [
  "/events-json",
  "/events",
  "/combat/tactical",
  "/combat?",
];

function shouldLogRequest(url: string | undefined): boolean {
  if (!url) return true;
  return !QUIET_ENDPOINTS.some((ep) => url.includes(ep));
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const isTest = process.env.NODE_ENV === "test" || process.env.VITEST;

  // Build logger configuration
  let loggerConfig: any;
  if (deps.logger === false) {
    loggerConfig = false;
  } else if (isTest) {
    loggerConfig = { level: "warn" };
  } else if (deps.logger && typeof deps.logger === "object") {
    loggerConfig = deps.logger;
  } else {
    loggerConfig = { level: "warn" }; // Suppress pino JSON; we log requests ourselves
  }

  const app = Fastify({
    logger: loggerConfig,
    disableRequestLogging: true, // We handle request logging ourselves
  });

  // Human-readable request logging (skips noisy polling endpoints)
  if (loggerConfig !== false && !isTest) {
    app.addHook("onResponse", (request, reply, done) => {
      if (shouldLogRequest(request.url)) {
        const time = new Date().toLocaleTimeString();
        const ms = Math.round(reply.elapsedTime);
        const status = reply.statusCode;
        console.log(`${time}  ${request.method} ${request.url} → ${status} (${ms}ms)`);
      }
      done();
    });
  }

  app.decorate("sseBroker", sseBroker);

  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof NotFoundError) {
      void reply.status(404).send({ error: error.name, message: error.message });
      return;
    }

    if (error instanceof ValidationError) {
      void reply.status(400).send({ error: error.name, message: error.message });
      return;
    }

    // Let Fastify handle logging; respond with minimal details.
    void reply.status(500).send({ error: "InternalServerError", message: "Internal Server Error" });
  });

  const sessions = new GameSessionService(deps.sessionsRepo, deps.eventsRepo);
  const characters = new CharacterService(deps.sessionsRepo, deps.charactersRepo, deps.eventsRepo, deps.diceRoller);
  const defaultItemDefinitionsRepo: IItemDefinitionRepository = {
    findById: async () => null,
    findByName: async () => null,
    listAll: async () => [],
    upsert: async (item) => ({
      ...item,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    }),
  };
  const itemLookup = new ItemLookupService(deps.itemDefinitionsRepo ?? defaultItemDefinitionsRepo);
  const factionService = new FactionService({
    combat: deps.combatRepo,
    characters: deps.charactersRepo,
    monsters: deps.monstersRepo,
    npcs: deps.npcsRepo,
  });
  const victoryPolicy = new BasicCombatVictoryPolicy(factionService);
  const diceRoller = deps.diceRoller ?? new RandomDiceRoller();

  // Two-phase action service for reactions (moved up so CombatService can use it for cleanup)
  const pendingActionsRepo: PendingActionRepository = deps.prismaClient
    ? new PrismaPendingActionRepository(deps.prismaClient)
    : new InMemoryPendingActionRepository();

  const combat = new CombatService(
    deps.sessionsRepo,
    deps.combatRepo,
    victoryPolicy,
    deps.eventsRepo,
    deps.charactersRepo,  // New: for domain hydration
    deps.monstersRepo,    // New: for domain hydration
    deps.npcsRepo,        // New: for domain hydration
    diceRoller,           // New: for Combat domain instance
    pendingActionsRepo,
  );

  const combatants = new CombatantResolver(deps.charactersRepo, deps.monstersRepo, deps.npcsRepo);
  const narrator = deps.narrativeGenerator
    ? {
        narrate: (input: { storyFramework: unknown; events: unknown[]; seed: number }) =>
          deps.narrativeGenerator!.narrate({
            storyFramework: input.storyFramework as any,
            events: input.events as any,
            seed: input.seed,
          }),
      }
    : undefined;
  const actions = new ActionService(deps.sessionsRepo, deps.combatRepo, combatants, deps.eventsRepo, narrator);
  const twoPhaseActions = new TwoPhaseActionService(
    deps.sessionsRepo,
    deps.combatRepo,
    combatants,
    pendingActionsRepo,
    deps.eventsRepo,
    {
      characters: deps.charactersRepo,
      monsters: deps.monstersRepo,
      npcs: deps.npcsRepo,
      diceRoller,
    },
  );
  
  const aiDecisionMaker = deps.aiDecisionMaker
    ?? (deps.llmProvider && deps.llmConfig
      ? new LlmAiDecisionMaker(deps.llmProvider, deps.llmConfig)
      : undefined);

  // Battle plan service for faction-level tactical planning
  const battlePlanner = deps.llmProvider && deps.llmConfig
    ? new LlmBattlePlanner(deps.llmProvider, deps.llmConfig)
    : undefined;
  const battlePlanService = new BattlePlanService(
    deps.combatRepo,
    factionService,
    combatants,
    battlePlanner,
  );
  
  // Configure ability registry with executors
  const abilityRegistry = new AbilityRegistry();
  abilityRegistry.register(new ActionSurgeExecutor());
  abilityRegistry.register(new IndomitableExecutor());
  abilityRegistry.register(new SecondWindExecutor());
  abilityRegistry.register(new NimbleEscapeExecutor());
  abilityRegistry.register(new CunningActionExecutor());
  abilityRegistry.register(new OffhandAttackExecutor());
  abilityRegistry.register(new FlurryOfBlowsExecutor());
  abilityRegistry.register(new PatientDefenseExecutor());
  abilityRegistry.register(new StepOfTheWindExecutor());
  abilityRegistry.register(new MartialArtsExecutor());
  abilityRegistry.register(new WholenessOfBodyExecutor());
  abilityRegistry.register(new RageExecutor());
  abilityRegistry.register(new RecklessAttackExecutor());
  abilityRegistry.register(new BrutalStrikeExecutor());
  abilityRegistry.register(new LayOnHandsExecutor());
  abilityRegistry.register(new TurnUndeadExecutor());
  
  const aiOrchestrator = new AiTurnOrchestrator(
    deps.combatRepo,
    deps.charactersRepo,
    deps.monstersRepo,
    deps.npcsRepo,
    factionService,
    actions,
    combat,
    combatants,
    abilityRegistry,
    twoPhaseActions,
    pendingActionsRepo,
    deps.diceRoller,
    aiDecisionMaker,
    deps.eventsRepo,
    battlePlanService,
  );
  
  // New services for refactored route modules
  const tacticalView = new TacticalViewService({
    combat,
    characters: deps.charactersRepo,
    monsters: deps.monstersRepo,
    npcs: deps.npcsRepo,
    combatRepo: deps.combatRepo,
  });
  
  const tabletopCombat = new TabletopCombatService({
    characters: deps.charactersRepo,
    monsters: deps.monstersRepo,
    npcs: deps.npcsRepo,
    combatRepo: deps.combatRepo,
    combat,
    actions,
    twoPhaseActions,
    combatants,
    pendingActions: pendingActionsRepo,
    events: deps.eventsRepo,
    aiOrchestrator,
    intentParser: deps.intentParser,
    narrativeGenerator: deps.narrativeGenerator,
    victoryPolicy,
    abilityRegistry,
    diceRoller: deps.diceRoller,
  });

  registerHealthRoutes(app);
  registerCatalogRoutes(app, { prismaClient: deps.prismaClient });
  registerReactionRoutes(app, {
    pendingActions: pendingActionsRepo,
    events: deps.eventsRepo,
    combat: deps.combatRepo,
    combatants,
    twoPhaseActions,
    aiOrchestrator,
    diceRoller: deps.diceRoller,
  });
  registerSessionRoutes(app, {
    sessions,
    characters,
    combat,
    actions,
    twoPhaseActions,
    pendingActions: pendingActionsRepo,
    aiOrchestrator,
    tacticalView,
    tabletopCombat,
    events: deps.eventsRepo,
    combatRepo: deps.combatRepo,
    combatants,
    monsters: deps.monstersRepo,
    npcs: deps.npcsRepo,
    charactersRepo: deps.charactersRepo,
    unitOfWork: deps.unitOfWork,
    storyGenerator: deps.storyGenerator,
    intentParser: deps.intentParser,
    narrativeGenerator: deps.narrativeGenerator,
    characterGenerator: deps.characterGenerator,
    diceRoller: deps.diceRoller,
    itemLookup,
    createServicesForRepos: (repos) => {
      const sessionsService = new GameSessionService(repos.sessionsRepo, repos.eventsRepo);
      const charactersService = new CharacterService(repos.sessionsRepo, repos.charactersRepo, repos.eventsRepo, deps.diceRoller);
      const factionServiceInner = new FactionService({
        combat: repos.combatRepo,
        characters: repos.charactersRepo,
        monsters: repos.monstersRepo,
        npcs: repos.npcsRepo,
      });
      const victoryPolicyInner = new BasicCombatVictoryPolicy(factionServiceInner);
      const diceRollerInner = deps.diceRoller ?? new RandomDiceRoller();
      const pendingActionsRepoInner = repos.pendingActionsRepo;
      const combatService = new CombatService(
        repos.sessionsRepo,
        repos.combatRepo,
        victoryPolicyInner,
        repos.eventsRepo,
        repos.charactersRepo,  // New: for domain hydration
        repos.monstersRepo,    // New: for domain hydration
        repos.npcsRepo,        // New: for domain hydration
        diceRollerInner,       // New: for Combat domain instance
        pendingActionsRepoInner,
      );

      const combatantsInner = new CombatantResolver(
        repos.charactersRepo,
        repos.monstersRepo,
        repos.npcsRepo,
      );
      const narratorInner = deps.narrativeGenerator
        ? {
            narrate: (input: { storyFramework: unknown; events: unknown[]; seed: number }) =>
              deps.narrativeGenerator!.narrate({
                storyFramework: input.storyFramework as any,
                events: input.events as any,
                seed: input.seed,
              }),
          }
        : undefined;
      const actionsService = new ActionService(
        repos.sessionsRepo,
        repos.combatRepo,
        combatantsInner,
        repos.eventsRepo,
        narratorInner,
      );
      const aiDecisionMakerInner = deps.llmProvider && deps.llmConfig
        ? new LlmAiDecisionMaker(deps.llmProvider, deps.llmConfig)
        : undefined;
      
      // Configure ability registry with executors (must match outer registry at L202-216)
      const abilityRegistryInner = new AbilityRegistry();
      abilityRegistryInner.register(new ActionSurgeExecutor());
      abilityRegistryInner.register(new SecondWindExecutor());
      abilityRegistryInner.register(new NimbleEscapeExecutor());
      abilityRegistryInner.register(new CunningActionExecutor());
      abilityRegistryInner.register(new OffhandAttackExecutor());
      abilityRegistryInner.register(new FlurryOfBlowsExecutor());
      abilityRegistryInner.register(new PatientDefenseExecutor());
      abilityRegistryInner.register(new StepOfTheWindExecutor());
      abilityRegistryInner.register(new MartialArtsExecutor());
      abilityRegistryInner.register(new WholenessOfBodyExecutor());
      
      // Two-phase action service
      const twoPhaseService = new TwoPhaseActionService(
        repos.sessionsRepo,
        repos.combatRepo,
        combatantsInner,
        pendingActionsRepoInner,
        repos.eventsRepo,
        {
          characters: repos.charactersRepo,
          monsters: repos.monstersRepo,
          npcs: repos.npcsRepo,
          diceRoller: diceRollerInner,
        },
      );
      
      const battlePlannerInner = deps.llmProvider && deps.llmConfig
        ? new LlmBattlePlanner(deps.llmProvider, deps.llmConfig)
        : undefined;
      const battlePlanServiceInner = new BattlePlanService(
        repos.combatRepo,
        factionServiceInner,
        combatantsInner,
        battlePlannerInner,
      );
      
      const aiOrchestratorInner = new AiTurnOrchestrator(
        repos.combatRepo,
        repos.charactersRepo,
        repos.monstersRepo,
        repos.npcsRepo,
        factionServiceInner,
        actionsService,
        combatService,
        combatantsInner,
        abilityRegistryInner,
        twoPhaseService,
        pendingActionsRepoInner,
        deps.diceRoller,
        aiDecisionMakerInner,
        repos.eventsRepo,
        battlePlanServiceInner,
      );
      return {
        sessions: sessionsService,
        characters: charactersService,
        combat: combatService,
        actions: actionsService,
        aiOrchestrator: aiOrchestratorInner,
      };
    },
  });

  return app;
}
