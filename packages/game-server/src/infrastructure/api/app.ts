import Fastify, { type FastifyInstance } from "fastify";

import {
  ActionService,
  CharacterService,
  CombatService,
  GameSessionService,
  TacticalViewService,
  TabletopCombatService,
} from "../../application/services/index.js";
import { AiTurnOrchestrator } from "../../application/services/combat/ai/index.js";
import { FactionService } from "../../application/services/combat/helpers/faction-service.js";
import { CombatantResolver } from "../../application/services/combat/helpers/combatant-resolver.js";
import { BasicCombatVictoryPolicy } from "../../application/services/combat/combat-victory-policy.js";
import { AbilityRegistry } from "../../application/services/combat/abilities/ability-registry.js";
import { 
  NimbleEscapeExecutor, 
  CunningActionExecutor, 
  OffhandAttackExecutor, 
  FlurryOfBlowsExecutor, 
  PatientDefenseExecutor, 
  StepOfTheWindExecutor, 
  MartialArtsExecutor,
  StunningStrikeExecutor,
  WholenessOfBodyExecutor,
  UncannyMetabolismExecutor,
  DeflectAttacksExecutor,
  OpenHandTechniqueExecutor
} from "../../application/services/combat/abilities/executors/index.js";
import { TwoPhaseActionService } from "../../application/services/combat/two-phase-action-service.js";
import { InMemoryPendingActionRepository } from "../../application/repositories/pending-action-repository.js";
import type {
  ICharacterRepository,
  ICombatRepository,
  IEventRepository,
  IGameSessionRepository,
  IMonsterRepository,
  INPCRepository,
  ISpellRepository,
} from "../../application/repositories/index.js";

import { registerHealthRoutes } from "./routes/health.js";
import { registerSessionRoutes } from "./routes/sessions/index.js";
import { registerReactionRoutes } from "./routes/reactions.js";
import { sseBroker } from "./realtime/sse-broker.js";
import { NotFoundError, ValidationError } from "../../application/errors.js";
import type { PrismaUnitOfWork } from "../db/unit-of-work.js";
import type { IStoryGenerator } from "../llm/story-generator.js";
import type { IIntentParser } from "../llm/intent-parser.js";
import type { INarrativeGenerator } from "../llm/narrative-generator.js";
import type { ICharacterGenerator } from "../llm/character-generator.js";
import type { IAiDecisionMaker } from "../../application/services/combat/ai/ai-types.js";
import { LlmAiDecisionMaker } from "../llm/ai-decision-maker.js";
import type { LlmProvider } from "../llm/types.js";
import type { DiceRoller } from "../../domain/rules/dice-roller.js";

export type AppDeps = {
  sessionsRepo: IGameSessionRepository;
  charactersRepo: ICharacterRepository;
  monstersRepo: IMonsterRepository;
  npcsRepo: INPCRepository;
  combatRepo: ICombatRepository;
  eventsRepo: IEventRepository;
  spellsRepo: ISpellRepository;
  unitOfWork?: PrismaUnitOfWork;
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

export function buildApp(deps: AppDeps): FastifyInstance {
  const inferredLogger: AppDeps["logger"] =
    deps.logger ??
    ((process.env.NODE_ENV === "test" || process.env.VITEST) ? { level: "warn" } : true);

  const app = Fastify({ logger: inferredLogger });

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
  const characters = new CharacterService(deps.sessionsRepo, deps.charactersRepo, deps.eventsRepo);
  const factionService = new FactionService({
    combat: deps.combatRepo,
    characters: deps.charactersRepo,
    monsters: deps.monstersRepo,
    npcs: deps.npcsRepo,
  });
  const victoryPolicy = new BasicCombatVictoryPolicy(factionService);
  const combat = new CombatService(
    deps.sessionsRepo,
    deps.combatRepo,
    victoryPolicy,
    deps.eventsRepo,
    deps.charactersRepo,  // New: for domain hydration
    deps.monstersRepo,    // New: for domain hydration
    deps.npcsRepo,        // New: for domain hydration
    deps.diceRoller,      // New: for Combat domain instance
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
  // Note: narrator adapter is prepared for future use but ActionService no longer takes it
  void narrator; // Suppress unused warning for now
  const actions = new ActionService(deps.sessionsRepo, deps.combatRepo, combatants, deps.eventsRepo);
  
  // Two-phase action service for reactions
  const pendingActionsRepo = new InMemoryPendingActionRepository();
  const twoPhaseActions = new TwoPhaseActionService(
    deps.sessionsRepo,
    deps.combatRepo,
    combatants,
    pendingActionsRepo,
    deps.eventsRepo,
  );
  
  const aiDecisionMaker = deps.aiDecisionMaker
    ?? (deps.llmProvider && deps.llmConfig
      ? new LlmAiDecisionMaker(deps.llmProvider, deps.llmConfig)
      : undefined);
  
  // Configure ability registry with executors
  const abilityRegistry = new AbilityRegistry();
  abilityRegistry.register(new NimbleEscapeExecutor());
  abilityRegistry.register(new CunningActionExecutor());
  abilityRegistry.register(new OffhandAttackExecutor());
  abilityRegistry.register(new FlurryOfBlowsExecutor());
  abilityRegistry.register(new PatientDefenseExecutor());
  abilityRegistry.register(new StepOfTheWindExecutor());
  abilityRegistry.register(new MartialArtsExecutor());
  abilityRegistry.register(new StunningStrikeExecutor());
  abilityRegistry.register(new WholenessOfBodyExecutor());
  abilityRegistry.register(new UncannyMetabolismExecutor());
  abilityRegistry.register(new DeflectAttacksExecutor());
  abilityRegistry.register(new OpenHandTechniqueExecutor());
  
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
    aiDecisionMaker,
    deps.eventsRepo,
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
  });

  registerHealthRoutes(app);
  registerReactionRoutes(app, {
    pendingActions: pendingActionsRepo,
    events: deps.eventsRepo,
    combatants,
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
    createServicesForRepos: (repos) => {
      const sessionsService = new GameSessionService(repos.sessionsRepo, repos.eventsRepo);
      const charactersService = new CharacterService(repos.sessionsRepo, repos.charactersRepo, repos.eventsRepo);
      const factionServiceInner = new FactionService({
        combat: repos.combatRepo,
        characters: repos.charactersRepo,
        monsters: repos.monstersRepo,
        npcs: repos.npcsRepo,
      });
      const victoryPolicyInner = new BasicCombatVictoryPolicy(factionServiceInner);
      const combatService = new CombatService(
        repos.sessionsRepo,
        repos.combatRepo,
        victoryPolicyInner,
        repos.eventsRepo,
        repos.charactersRepo,  // New: for domain hydration
        repos.monstersRepo,    // New: for domain hydration
        repos.npcsRepo,        // New: for domain hydration
        deps.diceRoller,       // New: for Combat domain instance
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
      void narratorInner; // Suppress unused warning for now
      const actionsService = new ActionService(
        repos.sessionsRepo,
        repos.combatRepo,
        combatantsInner,
        repos.eventsRepo,
      );
      const aiDecisionMakerInner = deps.llmProvider && deps.llmConfig
        ? new LlmAiDecisionMaker(deps.llmProvider, deps.llmConfig)
        : undefined;
      
      // Configure ability registry with executors
      const abilityRegistryInner = new AbilityRegistry();
      abilityRegistryInner.register(new NimbleEscapeExecutor());
      abilityRegistryInner.register(new CunningActionExecutor());
      
      // Two-phase action service
      const pendingActionsRepoInner = new InMemoryPendingActionRepository();
      const twoPhaseService = new TwoPhaseActionService(
        repos.sessionsRepo,
        repos.combatRepo,
        combatantsInner,
        pendingActionsRepoInner,
        repos.eventsRepo,
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
        aiDecisionMakerInner,
        repos.eventsRepo,
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
