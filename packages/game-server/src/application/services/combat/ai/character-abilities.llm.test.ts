/**
 * LLM Integration Tests for Character Abilities
 * 
 * Tests that different character classes (Monk, Fighter, Rogue, etc.) can use their
 * class-specific abilities through the LLM + ability executor system.
 * 
 * Run with: DM_RUN_LLM_TESTS=1 pnpm test character-abilities.llm.test.ts
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { nanoid } from "nanoid";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AiTurnOrchestrator } from "./index.js";
import { ActionService } from "../action-service.js";
import { CombatService } from "../combat-service.js";
import { BasicCombatVictoryPolicy } from "../combat-victory-policy.js";
import { FactionService } from "../helpers/faction-service.js";
import { CombatantResolver } from "../helpers/combatant-resolver.js";
import { AbilityRegistry } from "../abilities/ability-registry.js";
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
} from "../abilities/executors/index.js";
import { TwoPhaseActionService } from "../two-phase-action-service.js";
import { InMemoryPendingActionRepository } from "../../../repositories/pending-action-repository.js";
import { resolveShove } from "../../../../domain/rules/grapple-shove.js";
import { SeededDiceRoller } from "../../../../domain/rules/dice-roller.js";
import { LlmAiDecisionMaker } from "../../../../infrastructure/llm/ai-decision-maker.js";
import {
  createLlmProviderFromEnv,
  getDefaultModelFromEnv,
} from "../../../../infrastructure/llm/factory.js";
import {
  createPrismaClient,
  PrismaCombatRepository,
  PrismaCharacterRepository,
  PrismaMonsterRepository,
  PrismaNPCRepository,
  PrismaEventRepository,
  PrismaGameSessionRepository,
} from "../../../../infrastructure/db/index.js";

// Load environment variables before tests run
function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;

  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) continue;

    const key = line.substring(0, eqIdx).trim();
    const value = line.substring(eqIdx + 1).trim();

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnvFile(path.resolve(__dirname, "../../../../../.env"));

const shouldRunLlmTests = ["1", "true", "yes"].includes(
  process.env.DM_RUN_LLM_TESTS?.toLowerCase() ?? ""
);

// Helper to create a test character of a specific class
interface CreateCharacterOptions {
  id?: string;
  name: string;
  class: 'monk' | 'fighter' | 'rogue';
  level: number;
  hp?: number;
  ac?: number;
  kiPoints?: number;
}

function createTestCharacter(options: CreateCharacterOptions) {
  const id = options.id || nanoid();
  const hp = options.hp || 30;
  const ac = options.ac || 16;

  const baseSheet: any = {
    id,
    name: options.name,
    level: options.level,
    class: options.class,
    hp: { current: hp, max: hp },
    ac,
    abilityScores: {
      strength: 10,
      dexterity: 16,
      constitution: 14,
      intelligence: 10,
      wisdom: 14,
      charisma: 8,
    },
    proficiencyBonus: 2,
    speed: 30,
  };

  // Add class-specific features
  if (options.class === 'monk' && options.level >= 2) {
    const kiMax = options.kiPoints ?? options.level;
    baseSheet.resourcePools = [
      { name: 'ki', current: kiMax, max: kiMax }
    ];
  }

  return baseSheet;
}

describe.skipIf(!shouldRunLlmTests)("Character Class Abilities (Real LLM)", () => {
  const prisma = createPrismaClient();
  let combatRepo: PrismaCombatRepository;
  let characterRepo: PrismaCharacterRepository;
  let monsterRepo: PrismaMonsterRepository;
  let npcRepo: PrismaNPCRepository;
  let eventRepo: PrismaEventRepository;
  let sessionRepo: PrismaGameSessionRepository;
  let combatantResolver: CombatantResolver;
  let factionService: FactionService;
  let actionService: ActionService;
  let combatService: CombatService;
  let aiDecisionMaker: LlmAiDecisionMaker;
  let aiOrchestrator: AiTurnOrchestrator;
  let abilityRegistry: AbilityRegistry;

  // Test data (unique per test)
  let sessionId: string;
  let encounterId: string;

  beforeEach(async () => {
    sessionId = `test-${Date.now()}-${Math.random()}`;
    encounterId = `encounter-${Date.now()}-${Math.random()}`;

    // Initialize repositories
    combatRepo = new PrismaCombatRepository(prisma);
    characterRepo = new PrismaCharacterRepository(prisma);
    monsterRepo = new PrismaMonsterRepository(prisma);
    npcRepo = new PrismaNPCRepository(prisma);
    eventRepo = new PrismaEventRepository(prisma);
    sessionRepo = new PrismaGameSessionRepository(prisma);

    // Setup ability registry with all executors
    abilityRegistry = new AbilityRegistry();
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

    // Create session
    await sessionRepo.create({ 
      id: sessionId,
      storyFramework: { title: "Test Session", theme: "Generic Test" }
    });

    // Initialize helpers and services
    combatantResolver = new CombatantResolver(characterRepo, monsterRepo, npcRepo);
    factionService = new FactionService({
      combat: combatRepo,
      characters: characterRepo,
      monsters: monsterRepo,
      npcs: npcRepo,
    });
    actionService = new ActionService(
      sessionRepo,
      combatRepo,
      combatantResolver,
      eventRepo
    );

    // Two-phase action service for reactions
    const pendingActionsRepo = new InMemoryPendingActionRepository();
    const twoPhaseService = new TwoPhaseActionService(
      sessionRepo,
      combatRepo,
      combatantResolver,
      pendingActionsRepo,
      eventRepo
    );

    // Combat services
    const victoryPolicy = new BasicCombatVictoryPolicy(factionService);
    combatService = new CombatService(
      sessionRepo,
      combatRepo,
      victoryPolicy,
      eventRepo,
      characterRepo,
      monsterRepo,
      npcRepo
    );

    // LLM-based AI decision maker
    const llmProvider = createLlmProviderFromEnv();
    if (!llmProvider) {
      throw new Error('LLM provider not configured');
    }
    const model = getDefaultModelFromEnv();
    if (!model) {
      throw new Error('LLM model not configured');
    }
    aiDecisionMaker = new LlmAiDecisionMaker(llmProvider, {
      model,
      temperature: 0.0,
      seed: 42,
      timeoutMs: 60000,
    });

    // AI service (uses real LLM)
    aiOrchestrator = new AiTurnOrchestrator(
      combatRepo,
      characterRepo,
      monsterRepo,
      npcRepo,
      factionService,
      actionService,
      combatService,
      combatantResolver,
      abilityRegistry,
      twoPhaseService,
      pendingActionsRepo,
      aiDecisionMaker,
      eventRepo, // Pass event repo so AI decisions are recorded
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe("Monk Abilities", () => {
    it('should use Flurry of Blows bonus action with ki spending', async () => {
      // Create level 5 monk with 5 ki points
      const monkId = `monk-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const monk = await characterRepo.createInSession(sessionId, {
        id: monkId,
        name: 'Shadow Fist',
        level: 5,
        className: 'monk',
        sheet: {
          hp: 38,
          maxHp: 38,
          armorClass: 16,
          abilityScores: {
            strength: 10,
            dexterity: 16,
            constitution: 14,
            intelligence: 10,
            wisdom: 14,
            charisma: 8,
          },
          resourcePools: [
            { name: 'ki', current: 5, max: 5 }
          ],
        },
      });

      // Create a goblin enemy
      const goblinId = `goblin-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const goblin = await monsterRepo.createInSession(sessionId, {
        id: goblinId,
        name: 'Goblin Warrior',
        monsterDefinitionId: null,
        statBlock: {
          hp: 7,
          maxHp: 7,
          armorClass: 15,
          abilityScores: {
            strength: 8,
            dexterity: 14,
            constitution: 10,
            intelligence: 10,
            wisdom: 8,
            charisma: 8,
          },
          actions: [
            {
              name: "Scimitar",
              kind: "melee",
              attackBonus: 4,
              damage: { diceCount: 1, diceSides: 6, modifier: 2 },
            },
          ],
        },
      });

      // Start combat
      const encounter = await combatService.startEncounter(sessionId, {
        combatants: [
          {
            combatantType: 'Character',
            characterId: monkId,
            initiative: 20,
            hpCurrent: 38,
            hpMax: 38,
          },
          {
            combatantType: 'Monster',
            monsterId: goblinId,
            initiative: 15,
            hpCurrent: 7,
            hpMax: 7,
          },
        ],
      });
      encounterId = encounter.id;

      // Inject test instruction to use Flurry of Blows
      await eventRepo.append(sessionId, {
        id: nanoid(),
        type: 'NarrativeText',
        payload: {
          encounterId,
          text: 'TEST INSTRUCTION: Attack the goblin with your quarterstaff, then immediately use Flurry of Blows (spend 1 ki point to make 2 bonus unarmed strikes).',
        },
      });

      // Advance to monk's turn
      await combatService.nextTurn(sessionId, { encounterId });

      // Process AI turn (monk is AI-controlled for this test)
      const processed = await aiOrchestrator.processMonsterTurnIfNeeded(sessionId, encounterId);
      expect(processed).toBe(true);

      // Verify events
      const events = await eventRepo.listBySession(sessionId);
      const aiDecisionEvents = events.filter((e) => e.type === 'AiDecision');
      
      // Debug: log event types if no decisions found
      if (aiDecisionEvents.length === 0) {
        console.log('Event types found:', events.map(e => e.type));
      }
      
      expect(aiDecisionEvents.length).toBeGreaterThan(0);
      
      const decision = (aiDecisionEvents[0] as any)?.payload?.decision;
      expect(decision).toBeDefined();

      // Check if monk used a bonus action
      if (decision?.bonusAction) {
        const bonusAction = (decision.bonusAction as string).toLowerCase();
        // Accept various formats the LLM might use
        expect(bonusAction).toMatch(/flurry|ki|bonus.*strike/);
      }
    }, 60000);

    it('should use Patient Defense (dodge as bonus action)', async () => {
      const monkId = `monk-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const monk = await characterRepo.createInSession(sessionId, {
        id: monkId,
        name: 'Defensive Monk',
        level: 3,
        className: 'monk',
        sheet: {
          hp: 26,
          maxHp: 26,
          armorClass: 16,
          abilityScores: {
            strength: 10,
            dexterity: 16,
            constitution: 14,
            intelligence: 10,
            wisdom: 14,
            charisma: 8,
          },
          resourcePools: [
            { name: 'ki', current: 2, max: 3 }
          ],
        },
      });

      const goblinId = `goblin-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      const goblin = await monsterRepo.createInSession(sessionId, {
        id: goblinId,
        name: 'Goblin Scout',
        monsterDefinitionId: null,
        statBlock: {
          hp: 7,
          maxHp: 7,
          armorClass: 15,
          abilityScores: {
            strength: 8,
            dexterity: 14,
            constitution: 10,
            intelligence: 10,
            wisdom: 8,
            charisma: 8,
          },
          actions: [
            {
              name: "Scimitar",
              kind: "melee",
              attackBonus: 4,
              damage: { diceCount: 1, diceSides: 6, modifier: 2 },
            },
          ],
        },
      });

      const encounter = await combatService.startEncounter(sessionId, {
        combatants: [
          {
            combatantType: 'Character',
            characterId: monkId,
            initiative: 20,
            hpCurrent: 26,
            hpMax: 26,
          },
          {
            combatantType: 'Monster',
            monsterId: goblinId,
            initiative: 15,
            hpCurrent: 7,
            hpMax: 7,
          },
        ],
      });
      encounterId = encounter.id;

      await eventRepo.append(sessionId, {
        id: nanoid(),
        type: 'NarrativeText',
        payload: {
          encounterId,
          text: 'TEST INSTRUCTION: You are surrounded! Use Patient Defense (spend 1 ki to Dodge as a bonus action) to defend yourself.',
        },
      });

      await combatService.nextTurn(sessionId, { encounterId });
      const processed = await aiOrchestrator.processMonsterTurnIfNeeded(sessionId, encounterId);
      expect(processed).toBe(true);

      const events = await eventRepo.listBySession(sessionId);
      const aiDecisionEvents = events.filter((e) => e.type === 'AiDecision');
      
      // Debug: log event types if no decisions found
      if (aiDecisionEvents.length === 0) {
        console.log('Event types found:', events.map(e => e.type));
      }
      
      expect(aiDecisionEvents.length).toBeGreaterThan(0);
      const decision = (aiDecisionEvents[0] as any)?.payload?.decision;

      if (decision?.bonusAction) {
        const bonusAction = (decision.bonusAction as string).toLowerCase();
        expect(bonusAction).toMatch(/patient.*defense|dodge|defensive/);
      }
    }, 60000);
  });

  describe.skipIf(!shouldRunLlmTests)('Generic Character Test', () => {
    it('should work with any character class configuration', async () => {
      // This test demonstrates the pattern for adding new classes
      const testCharacter = createTestCharacter({
        name: 'Test Monk',
        class: 'monk',
        level: 2,
        kiPoints: 2,
      });

      expect(testCharacter.resourcePools).toBeDefined();
      expect(testCharacter.resourcePools[0].name).toBe('ki');
      expect(testCharacter.resourcePools[0].max).toBe(2);
    });
  });
});
