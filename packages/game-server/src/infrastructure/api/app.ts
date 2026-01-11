import Fastify, { type FastifyInstance } from "fastify";

import {
  ActionService,
  CharacterService,
  CombatService,
  GameSessionService,
} from "../../application/services/index.js";
import { MonsterAIService } from "../../application/services/combat/ai/monster-ai-service.js";
import { FactionService } from "../../application/services/combat/helpers/faction-service.js";
import { CombatantResolver } from "../../application/services/combat/helpers/combatant-resolver.js";
import { BasicCombatVictoryPolicy } from "../../application/services/combat/combat-victory-policy.js";
import { AbilityRegistry } from "../../application/services/combat/abilities/ability-registry.js";
import { NimbleEscapeExecutor, CunningActionExecutor } from "../../application/services/combat/abilities/executors/index.js";
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
import { registerSessionRoutes } from "./routes/sessions.js";
import { registerReactionRoutes } from "./routes/reactions.js";
import { sseBroker } from "./realtime/sse-broker.js";
import { NotFoundError, ValidationError } from "../../application/errors.js";
import type { PrismaUnitOfWork } from "../db/unit-of-work.js";
import type { IStoryGenerator } from "../llm/story-generator.js";
import type { IIntentParser } from "../llm/intent-parser.js";
import type { INarrativeGenerator } from "../llm/narrative-generator.js";
import type { ICharacterGenerator } from "../llm/character-generator.js";
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
  const actions = new ActionService(deps.sessionsRepo, deps.combatRepo, combatants, deps.eventsRepo, narrator);
  
  // Two-phase action service for reactions
  const pendingActionsRepo = new InMemoryPendingActionRepository();
  const twoPhaseActions = new TwoPhaseActionService(
    deps.sessionsRepo,
    deps.combatRepo,
    combatants,
    pendingActionsRepo,
    deps.eventsRepo,
  );
  
  const aiDecisionMaker = deps.llmProvider && deps.llmConfig
    ? new LlmAiDecisionMaker(deps.llmProvider, deps.llmConfig)
    : undefined;
  
  // Configure ability registry with executors
  const abilityRegistry = new AbilityRegistry();
  abilityRegistry.register(new NimbleEscapeExecutor());
  abilityRegistry.register(new CunningActionExecutor());
  
  const monsterAI = new MonsterAIService(
    deps.combatRepo,
    deps.charactersRepo,
    deps.monstersRepo,
    deps.npcsRepo,
    factionService,
    actions,
    combat,
    combatants,
    abilityRegistry,
    aiDecisionMaker,
    deps.eventsRepo,
  );

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
    monsterAI,
    events: deps.eventsRepo,
    combatRepo: deps.combatRepo,
    monsters: deps.monstersRepo,
    npcs: deps.npcsRepo,
    unitOfWork: deps.unitOfWork,
    storyGenerator: deps.storyGenerator,
    intentParser: deps.intentParser,
    narrativeGenerator: deps.narrativeGenerator,
    characterGenerator: deps.characterGenerator,
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
      
      // Configure ability registry with executors
      const abilityRegistryInner = new AbilityRegistry();
      abilityRegistryInner.register(new NimbleEscapeExecutor());
      abilityRegistryInner.register(new CunningActionExecutor());
      
      const monsterAIService = new MonsterAIService(
        repos.combatRepo,
        repos.charactersRepo,
        repos.monstersRepo,
        repos.npcsRepo,
        factionServiceInner,
        actionsService,
        combatService,
        combatantsInner,
        abilityRegistryInner,
        aiDecisionMakerInner,
        repos.eventsRepo,
      );
      return {
        sessions: sessionsService,
        characters: charactersService,
        combat: combatService,
        actions: actionsService,
        monsterAI: monsterAIService,
      };
    },
  });

  return app;
}
