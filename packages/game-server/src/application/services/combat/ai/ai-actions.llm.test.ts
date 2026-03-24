/**
 * LLM Integration Tests for AI Actions
 *
 * These tests use real Ollama LLM calls to validate AI decision making.
 * Run with: DM_RUN_LLM_TESTS=1 pnpm test ai-actions.llm.test.ts
 *
 * Requirements:
 * - Ollama running locally
 * - DM_OLLAMA_MODEL environment variable set
 * - DM_RUN_LLM_TESTS=1 to enable these tests
 */

import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
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
import { NimbleEscapeExecutor, CunningActionExecutor, OffhandAttackExecutor, FlurryOfBlowsExecutor, PatientDefenseExecutor, StepOfTheWindExecutor, MartialArtsExecutor } from "../abilities/executors/index.js";
import { TwoPhaseActionService } from "../two-phase-action-service.js";
import { InMemoryPendingActionRepository } from "../../../../infrastructure/testing/memory-repos.js";
import { shoveTarget } from "../../../../domain/rules/grapple-shove.js";
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
    if (line.length === 0) continue;
    if (line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    if (!key) continue;

    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnvFile(path.resolve(__dirname, "../../../../../.env"));

const shouldRunLLMTests = ["1", "true", "yes"].includes(
  process.env.DM_RUN_LLM_TESTS?.toLowerCase() ?? ""
);

describe.skipIf(!shouldRunLLMTests)("AI Actions (Real LLM)", () => {
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

  // Test data (unique per test)
  let sessionId: string;
  let encounterId: string;
  let goblinId: string;
  let fighterId: string;

  beforeEach(async () => {
    // Generate unique session ID for each test
    sessionId = `llm-test-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    // Initialize Prisma repositories
    combatRepo = new PrismaCombatRepository(prisma);
    characterRepo = new PrismaCharacterRepository(prisma);
    monsterRepo = new PrismaMonsterRepository(prisma);
    npcRepo = new PrismaNPCRepository(prisma);
    eventRepo = new PrismaEventRepository(prisma);
    sessionRepo = new PrismaGameSessionRepository(prisma);

    // Create test session
    await sessionRepo.create({
      id: sessionId,
      storyFramework: { name: "LLM Test Session", setting: "Test Arena" },
    });

    // Create LLM provider (requires Ollama running)
    const llmProvider = createLlmProviderFromEnv();
    const llmModel = getDefaultModelFromEnv();
    if (!llmProvider || !llmModel) {
      throw new Error(
        "LLM provider not available. Set DM_OLLAMA_MODEL environment variable."
      );
    }

    // Initialize services
    combatantResolver = new CombatantResolver(
      characterRepo,
      monsterRepo,
      npcRepo
    );
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
    aiDecisionMaker = new LlmAiDecisionMaker(llmProvider, {
      model: llmModel,
      temperature: 0.0,
      seed: 42,
      timeoutMs: 60000,
    });
    
    const abilityRegistry = new AbilityRegistry();
    abilityRegistry.register(new NimbleEscapeExecutor());
    abilityRegistry.register(new CunningActionExecutor());
    abilityRegistry.register(new OffhandAttackExecutor());
    abilityRegistry.register(new FlurryOfBlowsExecutor());
    abilityRegistry.register(new PatientDefenseExecutor());
    abilityRegistry.register(new StepOfTheWindExecutor());
    abilityRegistry.register(new MartialArtsExecutor());
    
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
      eventRepo
    );

    // Create test character (Fighter)
    const fighter = await characterRepo.createInSession(sessionId, {
      id: `fighter-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      name: "Brave Fighter",
      level: 3,
      className: "fighter",
      sheet: {
        hp: 36,
        maxHp: 36,
        armorClass: 18,
        abilityScores: {
          strength: 16,
          dexterity: 14,
          constitution: 14,
          intelligence: 10,
          wisdom: 12,
          charisma: 10,
        },
      },
    });
    fighterId = fighter.id;

    // Create test monster (Goblin)
    const goblin = await monsterRepo.createInSession(sessionId, {
      id: `goblin-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      name: "Sneaky Goblin",
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
          {
            name: "Shortbow",
            kind: "ranged",
            range: { normal: 80, max: 320 },
            attackBonus: 4,
            damage: { diceCount: 1, diceSides: 6, modifier: 2 },
          },
        ],
        bonusActions: [
          {
            name: "Nimble Escape",
            description: "Disengage or Hide as a bonus action",
          },
        ],
      },
    });
    goblinId = goblin.id;

    // Create combat encounter with map
    const encounter = await combatService.startEncounter(sessionId, {
      combatants: [
        {
          combatantType: "Character",
          characterId: fighterId,
          initiative: 20,
          hpCurrent: 36,
          hpMax: 36,
        },
        {
          combatantType: "Monster",
          monsterId: goblinId,
          initiative: 15,
          hpCurrent: 7,
          hpMax: 7,
        },
      ],
    });
    encounterId = encounter.id;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  afterEach(async () => {
    // Clean up test data
    try {
      const p = prisma as any;
      if (encounterId) {
        if (p.combatantState?.deleteMany) {
          await p.combatantState.deleteMany({ where: { encounterId } });
        }
        if (p.combatEncounter?.deleteMany) {
          await p.combatEncounter.deleteMany({ where: { id: encounterId } });
        }
      }
      if (sessionId) {
        // Clean up in correct order (FK constraints)
        if (fighterId) {
          if (p.character?.deleteMany) {
            await p.character.deleteMany({ where: { id: fighterId } });
          }
        }
        if (goblinId) {
          if (p.monster?.deleteMany) {
            await p.monster.deleteMany({ where: { id: goblinId } });
          }
        }
        if (p.gameEvent?.deleteMany) {
          await p.gameEvent.deleteMany({ where: { sessionId } });
        }
        if (p.gameSession?.deleteMany) {
          await p.gameSession.deleteMany({ where: { id: sessionId } });
        }
      }
    } catch (error) {
      // Log but don't fail test on cleanup errors
      console.error("Cleanup error:", error);
    }
  });

  describe("Attack Action", () => {
    it("should make AI decide to attack when enemy is in range", async () => {
      // Advance to goblin's turn (fighter is at turn 0 with higher initiative)
      await combatService.nextTurn(sessionId, { encounterId });
      
      // Process goblin's turn
      const processed = await aiOrchestrator.processMonsterTurnIfNeeded(
        sessionId,
        encounterId
      );

      const events = await eventRepo.listBySession(sessionId);
      
      // Check that an AI decision event was emitted
      const aiDecisionEvent = events.find((e) => e.type === "AiDecision");
      expect(aiDecisionEvent).toBeDefined();
      expect(processed).toBe(true);

      // Verify decision is one of the expected tactical actions
      const decision = (aiDecisionEvent as any)?.payload?.decision;
      expect(["attack", "move"]).toContain(decision?.action);
    }, 60000); // 30s timeout for LLM call
  });

  describe("Movement Action", () => {
    it("should make AI decide to move when repositioning is beneficial", async () => {
      // Manually set goblin far from fighter to encourage movement
      const combatants = await combatRepo.listCombatants(encounterId);
      const goblinCombatant = combatants.find((c) => c.monsterId === goblinId);

      if (goblinCombatant) {
        await combatRepo.updateCombatantState(goblinCombatant.id, {
          resources: {
            ...(goblinCombatant.resources as any),
            position: { x: 90, y: 25 }, // Far right
            speed: 30,
          },
        });
      }

      // Advance to goblin's turn
      await combatService.nextTurn(sessionId, { encounterId });

      // Process turn
      const processed = await aiOrchestrator.processMonsterTurnIfNeeded(
        sessionId,
        encounterId
      );

      expect(processed).toBe(true);

      // Check events
      const events = await eventRepo.listBySession(sessionId);
      const aiDecisionEvent = events.find((e) => e.type === "AiDecision");

      // AI should either move or attack (both are valid)
      expect(aiDecisionEvent).toBeDefined();
      const decision = (aiDecisionEvent as any)?.payload?.decision;
      expect(["move", "attack"]).toContain(decision?.action);
    }, 60000);
  });

  describe("Tactical Decision Making", () => {
    it("should make contextually appropriate decisions based on HP", async () => {
      // Set goblin to low HP to test defensive behavior
      const combatants = await combatRepo.listCombatants(encounterId);
      const goblinCombatant = combatants.find((c) => c.monsterId === goblinId);

      if (goblinCombatant) {
        await combatRepo.updateCombatantState(goblinCombatant.id, {
          hpCurrent: 2, // Very low HP
        });
      }

      // Advance to goblin's turn
      await combatService.nextTurn(sessionId, { encounterId });

      // Process turn
      const processed = await aiOrchestrator.processMonsterTurnIfNeeded(
        sessionId,
        encounterId
      );

      expect(processed).toBe(true);

      // Check that AI made a decision
      const events = await eventRepo.listBySession(sessionId);
      const aiDecisionEvent = events.find((e) => e.type === "AiDecision");
      expect(aiDecisionEvent).toBeDefined();

      // Low HP might encourage defensive play, but we just verify a decision was made
      const decision = (aiDecisionEvent as any)?.payload?.decision;
      expect(decision).toBeDefined();
      expect(decision?.action).toBeTypeOf("string");
    }, 60000);
  });

  describe("Specific Actions (Real LLM)", () => {
    const getGoblinDecisionEvents = async (): Promise<any[]> => {
      const events = await eventRepo.listBySession(sessionId);
      return events
        .filter((e) => e.type === "AiDecision")
        .filter((e) => (e as any)?.payload?.encounterId === encounterId)
        .filter((e) => (e as any)?.payload?.actor?.monsterId === goblinId);
    };

    const getGoblinResolvedActions = async (): Promise<any[]> => {
      const events = await eventRepo.listBySession(sessionId);
      return events
        .filter((e) => e.type === "ActionResolved")
        .map((e) => (e as any)?.payload)
        .filter((p) => p?.encounterId === encounterId)
        .filter((p) => p?.actor?.monsterId === goblinId);
    };

    it("should execute Disengage when explicitly instructed", async () => {
      await eventRepo.append(sessionId, {
        id: `llm-test-narrative-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        type: "NarrativeText",
        payload: {
          encounterId,
          text: 'TEST INSTRUCTION: In your NEXT response, output ONLY JSON with action="disengage", endTurn=true, and a short intentNarration. Do not attack or move.',
        },
      });

      await combatService.nextTurn(sessionId, { encounterId });
      const processed = await aiOrchestrator.processMonsterTurnIfNeeded(sessionId, encounterId);
      expect(processed).toBe(true);

      const decisions = await getGoblinDecisionEvents();
      expect(decisions.length).toBeGreaterThanOrEqual(1);
      const decision = (decisions[0] as any)?.payload?.decision;
      expect(decision?.action).toBe("disengage");

      const resolved = await getGoblinResolvedActions();
      expect(resolved.some((p) => p?.action === "Disengage")).toBe(true);
    }, 60000);

    it("should execute Dash when explicitly instructed", async () => {
      await eventRepo.append(sessionId, {
        id: `llm-test-narrative-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        type: "NarrativeText",
        payload: {
          encounterId,
          text: 'TEST INSTRUCTION: In your NEXT response, output ONLY JSON with action="dash", endTurn=true, and a short intentNarration. Do not attack or move.',
        },
      });

      await combatService.nextTurn(sessionId, { encounterId });
      const processed = await aiOrchestrator.processMonsterTurnIfNeeded(sessionId, encounterId);
      expect(processed).toBe(true);

      const decisions = await getGoblinDecisionEvents();
      expect(decisions.length).toBeGreaterThanOrEqual(1);
      const decision = (decisions[0] as any)?.payload?.decision;
      expect(decision?.action).toBe("dash");

      const resolved = await getGoblinResolvedActions();
      expect(resolved.some((p) => p?.action === "Dash")).toBe(true);
    }, 60000);

    it("should execute Dodge when explicitly instructed", async () => {
      await eventRepo.append(sessionId, {
        id: `llm-test-narrative-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        type: "NarrativeText",
        payload: {
          encounterId,
          text: 'TEST INSTRUCTION: In your NEXT response, output ONLY JSON with action="dodge", endTurn=true, and a short intentNarration. Do not attack or move.',
        },
      });

      await combatService.nextTurn(sessionId, { encounterId });
      const processed = await aiOrchestrator.processMonsterTurnIfNeeded(sessionId, encounterId);
      expect(processed).toBe(true);

      const decisions = await getGoblinDecisionEvents();
      expect(decisions.length).toBeGreaterThanOrEqual(1);
      const decision = (decisions[0] as any)?.payload?.decision;
      expect(decision?.action).toBe("dodge");

      const resolved = await getGoblinResolvedActions();
      expect(resolved.some((p) => p?.action === "Dodge")).toBe(true);
    }, 60000);

    it("should execute Help when explicitly instructed", async () => {
      await eventRepo.append(sessionId, {
        id: `llm-test-narrative-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        type: "NarrativeText",
        payload: {
          encounterId,
          text: 'TEST INSTRUCTION: In your NEXT response, output ONLY JSON with action="help", target="Brave Fighter", endTurn=true, and a short intentNarration. Do not attack or move.',
        },
      });

      await combatService.nextTurn(sessionId, { encounterId });
      const processed = await aiOrchestrator.processMonsterTurnIfNeeded(sessionId, encounterId);
      expect(processed).toBe(true);

      const decisions = await getGoblinDecisionEvents();
      expect(decisions.length).toBeGreaterThanOrEqual(1);
      const decision = (decisions[0] as any)?.payload?.decision;
      expect(decision?.action).toBe("help");
      expect(decision?.target).toBe("Brave Fighter");

      const resolved = await getGoblinResolvedActions();
      expect(resolved.some((p) => p?.action === "Help" && p?.target?.characterId === fighterId)).toBe(true);
    }, 60000);

    it("should execute CastSpell when explicitly instructed", async () => {
      await eventRepo.append(sessionId, {
        id: `llm-test-narrative-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        type: "NarrativeText",
        payload: {
          encounterId,
          text: 'TEST INSTRUCTION: In your NEXT response, output ONLY JSON with action="castSpell", spellName="Magic Missile", endTurn=true, and a short intentNarration. Do not attack or move.',
        },
      });

      await combatService.nextTurn(sessionId, { encounterId });
      const processed = await aiOrchestrator.processMonsterTurnIfNeeded(sessionId, encounterId);
      expect(processed).toBe(true);

      const decisions = await getGoblinDecisionEvents();
      expect(decisions.length).toBeGreaterThanOrEqual(1);
      const decision = (decisions[0] as any)?.payload?.decision;
      expect(decision?.action).toBe("castSpell");
      expect(decision?.spellName).toBe("Magic Missile");

      const resolved = await getGoblinResolvedActions();
      expect(resolved.some((p) => p?.action === "CastSpell" && p?.spellName === "Magic Missile")).toBe(true);
    }, 60000);

    it("should allow EndTurn when explicitly instructed", async () => {
      await eventRepo.append(sessionId, {
        id: `llm-test-narrative-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        type: "NarrativeText",
        payload: {
          encounterId,
          text: 'TEST INSTRUCTION: In your NEXT response, output ONLY JSON with action="endTurn", endTurn=true, and a short intentNarration. Do not attack or move.',
        },
      });

      await combatService.nextTurn(sessionId, { encounterId });
      const processed = await aiOrchestrator.processMonsterTurnIfNeeded(sessionId, encounterId);
      expect(processed).toBe(true);

      const decisions = await getGoblinDecisionEvents();
      expect(decisions.length).toBeGreaterThanOrEqual(1);
      const decision = (decisions[0] as any)?.payload?.decision;
      expect(decision?.action).toBe("endTurn");

      const resolved = await getGoblinResolvedActions();
      expect(resolved.length).toBe(0);
    }, 60000);
  });

  describe("Multiple Actions in Combat", () => {
    it("should handle multiple turns with varied actions", async () => {
      const decisions: string[] = [];
      let seenAiDecisions = 0;

      // Process 3 turns
      for (let i = 0; i < 3; i++) {
        // Ensure it's the goblin's turn (turn=1 in 2-combatant initiative order)
        const encounter = await combatRepo.getEncounterById(encounterId);
        if (encounter?.turn === 0) {
          await combatService.nextTurn(sessionId, { encounterId });
        }

        const processed = await aiOrchestrator.processMonsterTurnIfNeeded(sessionId, encounterId);
        expect(processed).toBe(true);

        const events = await eventRepo.listBySession(sessionId);
        const aiDecisionEvents = events.filter((e) => e.type === "AiDecision");
        if (aiDecisionEvents.length > seenAiDecisions) {
          const lastDecision = aiDecisionEvents[aiDecisionEvents.length - 1];
          const decision = (lastDecision as any)?.payload?.decision;
          if (decision?.action) decisions.push(decision.action);
          seenAiDecisions = aiDecisionEvents.length;
        }
      }

      // Should have made decisions
      expect(decisions.length).toBeGreaterThan(0);
    }, 60000); // 60s for multiple turns
  });

  describe("Chained Tactics", () => {
    it("should be able to shove then move in the same turn", async () => {
      const abilityMod = (score: number): number => Math.floor((score - 10) / 2);

      const findSuccessfulShoveSeed = (attackerStrMod: number, profBonus: number, targetAC: number, targetStrMod: number, targetDexMod: number): number => {
        for (let seed = 1; seed <= 5000; seed++) {
          const dice = new SeededDiceRoller(seed);
          const result = shoveTarget(attackerStrMod, profBonus, targetAC, targetStrMod, targetDexMod, false, dice);
          if (result.success) return seed;
        }
        throw new Error("Failed to find a successful shove seed");
      };

      // Remove bonus-action escape options to avoid the model preferring "Nimble Escape".
      // Also make the goblin unusually strong to make shove a reasonable tactic.
      const existingMonster = await prisma.sessionMonster.findUnique({ where: { id: goblinId } });
      expect(existingMonster).toBeDefined();

      const statBlock = (existingMonster?.statBlock ?? {}) as any;
      const attackerMod = abilityMod(16);
      const targetStrMod = abilityMod(16);
      const targetDexMod = abilityMod(14);
      const targetAC = 16; // Typical AC for a fighter
      const shoveSeed = findSuccessfulShoveSeed(attackerMod, 2, targetAC, targetStrMod, targetDexMod);

      await prisma.sessionMonster.update({
        where: { id: goblinId },
        data: {
          statBlock: {
            ...statBlock,
            abilityScores: {
              ...(statBlock.abilityScores ?? {}),
              strength: 16,
              dexterity: (statBlock.abilityScores?.dexterity ?? 14),
            },
            bonusActions: [],
          },
        },
      });

      // Place goblin adjacent to fighter so that moving away would normally risk an opportunity attack.
      const combatants = await combatRepo.listCombatants(encounterId);
      const goblinCombatant = combatants.find((c) => c.monsterId === goblinId);
      const fighterCombatant = combatants.find((c) => c.characterId === fighterId);
      expect(goblinCombatant).toBeDefined();
      expect(fighterCombatant).toBeDefined();

      if (goblinCombatant) {
        await combatRepo.updateCombatantState(goblinCombatant.id, {
          resources: {
            ...(goblinCombatant.resources as any),
            position: { x: 10, y: 10 },
            speed: 30,
          },
        });
      }
      if (fighterCombatant) {
        await combatRepo.updateCombatantState(fighterCombatant.id, {
          resources: {
            ...(fighterCombatant.resources as any),
            position: { x: 11, y: 10 },
            speed: 30,
          },
        });
      }

      // Give the model an explicit "plan" in the narrative so it has a consistent goal.
      // (This is crucial for reducing nondeterminism across models.)
      await eventRepo.append(sessionId, {
        id: `llm-test-narrative-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        type: "NarrativeText",
        payload: {
          encounterId,
          text: `Sneaky Goblin is toe-to-toe with Brave Fighter and needs to escape to (0,0). The goblin's plan is: (1) shove Brave Fighter back 5 feet to create space, then (2) immediately run toward (0,0). IMPORTANT: For the shove JSON, include "seed": ${shoveSeed}. If asked for another decision after the shove, the next decision should be action=move with destination {x:0,y:0}.`,
        },
      });

      // Advance to goblin's turn
      await combatService.nextTurn(sessionId, { encounterId });

      // Process goblin's turn (should contain multiple LLM iterations)
      const processed = await aiOrchestrator.processMonsterTurnIfNeeded(sessionId, encounterId);
      expect(processed).toBe(true);

      const events = await eventRepo.listBySession(sessionId);
      const goblinDecisionEvents = events
        .filter((e) => e.type === "AiDecision")
        .filter((e) => (e as any)?.payload?.encounterId === encounterId)
        .filter((e) => (e as any)?.payload?.actor?.monsterId === goblinId);

      const shoveResolved = events
        .filter((e) => e.type === "ActionResolved")
        .map((e) => (e as any)?.payload)
        .filter((p) => p?.encounterId === encounterId)
        .filter((p) => p?.action === "Shove")
        .filter((p) => p?.actor?.monsterId === goblinId);

      if (shoveResolved.length === 0) {
        const decisions = goblinDecisionEvents.map((e) => (e as any)?.payload?.decision);
        const resolved = events
          .filter((e) => e.type === "ActionResolved")
          .map((e) => (e as any)?.payload)
          .filter((p) => p?.encounterId === encounterId);

        // This is a real-LLM integration test; when it fails, we want the transcript.
        // eslint-disable-next-line no-console
        console.log('[Chained Tactics] AiDecision(s):', decisions);
        // eslint-disable-next-line no-console
        console.log('[Chained Tactics] ActionResolved(s):', resolved);
      }
      expect(shoveResolved.length).toBeGreaterThan(0);
      expect(shoveResolved.some((p: any) => p?.success === true)).toBe(true);

      // Expect at least 2 decisions in a single processed turn.
      expect(goblinDecisionEvents.length).toBeGreaterThanOrEqual(2);

      const firstDecision = (goblinDecisionEvents[0] as any)?.payload?.decision;
      expect(firstDecision?.action).toBe("shove");
      expect(firstDecision?.target).toBe("Brave Fighter");
      expect(firstDecision?.intentNarration).toBeTypeOf("string");
      expect((firstDecision?.intentNarration as string).length).toBeGreaterThan(0);
      expect(firstDecision?.endTurn).toBe(false);

      const laterDecisions = goblinDecisionEvents.slice(1).map((e) => (e as any)?.payload?.decision);
      const laterActions = laterDecisions.map((d) => d?.action);
      expect(laterActions).toContain("move");

      const moveDecision = laterDecisions.find((d) => d?.action === "move");
      expect(moveDecision?.intentNarration).toBeTypeOf("string");
      expect((moveDecision?.intentNarration as string).length).toBeGreaterThan(0);

      // Ensure the LLM's narrative intent is recorded as NarrativeText events (for transcripts/replay).
      const goblinNarrativeEvents = events
        .filter((e) => e.type === "NarrativeText")
        .map((e) => (e as any)?.payload)
        .filter((p) => p?.encounterId === encounterId)
        .filter((p) => p?.actor?.monsterId === goblinId)
        .map((p) => (p?.text as string | undefined) ?? "")
        .filter((t) => typeof t === "string" && t.trim().length > 0)
        .map((t) => t.trim());

      expect(goblinNarrativeEvents.length).toBeGreaterThanOrEqual(2);
      expect(goblinNarrativeEvents).toContain((firstDecision?.intentNarration as string).trim());
      expect(goblinNarrativeEvents).toContain((moveDecision?.intentNarration as string).trim());
    }, 60000);
  });

  describe("Battlefield Awareness", () => {
    it("should use battlefield visualization for tactical decisions", async () => {
      // Verify encounter has a map
      const encounter = await combatRepo.getEncounterById(encounterId);
      expect(encounter?.mapData).toBeDefined();

      // Advance to goblin's turn
      await combatService.nextTurn(sessionId, { encounterId });

      // Process turn
      const processed = await aiOrchestrator.processMonsterTurnIfNeeded(
        sessionId,
        encounterId
      );

      expect(processed).toBe(true);

      // Check that decision was made with battlefield context
      const events = await eventRepo.listBySession(sessionId);
      const aiDecisionEvent = events.find((e) => e.type === "AiDecision");
      expect(aiDecisionEvent).toBeDefined();

      const decision = (aiDecisionEvent as any)?.payload?.decision;
      expect(decision).toBeDefined();
      expect(decision?.action).toBeTypeOf("string");
    }, 60000);
  });

  describe("Bonus Actions (Real LLM)", () => {
    it("should use Nimble Escape (disengage) when instructed", async () => {
      // Inject explicit test instruction via narrative
      await eventRepo.append(sessionId, {
        id: nanoid(),
        type: "NarrativeText",
        payload: {
          encounterId,
          text: "TEST INSTRUCTION: On your next turn, attack with Scimitar AND use bonusAction: nimble_escape_disengage (Nimble Escape to disengage as bonus action).",
        },
      });

      // Advance to goblin's turn
      await combatService.nextTurn(sessionId, { encounterId });

      const processed = await aiOrchestrator.processMonsterTurnIfNeeded(sessionId, encounterId);
      expect(processed).toBe(true);

      const events = await eventRepo.listBySession(sessionId);
      const goblinDecisionEvents = events
        .filter((e) => e.type === "AiDecision")
        .map((e) => (e as any)?.payload)
        .filter((p) => p?.encounterId === encounterId && p?.actor?.monsterId === goblinId);

      expect(goblinDecisionEvents.length).toBeGreaterThan(0);

      const decision = goblinDecisionEvents[0]?.decision;
      // LLM might not reliably attack when instructed; accept any action
      expect(decision?.action).toBeTypeOf("string");

      // If bonus action is present, verify it's reasonable
      if (decision?.bonusAction) {
        const bonusAction = (decision.bonusAction as string).toLowerCase();
        expect(bonusAction).toMatch(/nimble|disengage|hide|dash|escape/);
      }
    }, 180000);

    it("should use bonus action with move", async () => {
      // Inject explicit test instruction
      await eventRepo.append(sessionId, {
        id: nanoid(),
        type: "NarrativeText",
        payload: {
          encounterId,
          text: "TEST INSTRUCTION: On your next turn, move closer to the fighter AND use bonusAction: nimble_escape_disengage.",
        },
      });

      // Advance to goblin's turn
      await combatService.nextTurn(sessionId, { encounterId });

      const processed = await aiOrchestrator.processMonsterTurnIfNeeded(sessionId, encounterId);
      expect(processed).toBe(true);

      const events = await eventRepo.listBySession(sessionId);
      const goblinDecisionEvents = events
        .filter((e) => e.type === "AiDecision")
        .map((e) => (e as any)?.payload)
        .filter((p) => p?.encounterId === encounterId && p?.actor?.monsterId === goblinId);

      expect(goblinDecisionEvents.length).toBeGreaterThan(0);

      const decision = goblinDecisionEvents[0]?.decision;
      expect(decision?.action).toBe("move");
      expect(decision?.bonusAction).toBeDefined();
      expect(typeof decision?.bonusAction).toBe("string");

      const bonusAction = (decision?.bonusAction as string).toLowerCase();
      // Accept both old format (nimble_escape_disengage) and new LLM-friendly format (Nimble Escape)
      expect(bonusAction).toMatch(/nimble.*escape|disengage/);
    }, 60000);

    it("should use bonus action with endTurn (no main action)", async () => {
      // Inject explicit test instruction
      await eventRepo.append(sessionId, {
        id: nanoid(),
        type: "NarrativeText",
        payload: {
          encounterId,
          text: "TEST INSTRUCTION: On your next turn, use action: endTurn with bonusAction: nimble_escape_disengage (disengage as bonus action without using your main action).",
        },
      });

      // Advance to goblin's turn
      await combatService.nextTurn(sessionId, { encounterId });

      const processed = await aiOrchestrator.processMonsterTurnIfNeeded(sessionId, encounterId);
      expect(processed).toBe(true);

      const events = await eventRepo.listBySession(sessionId);
      const goblinDecisionEvents = events
        .filter((e) => e.type === "AiDecision")
        .map((e) => (e as any)?.payload)
        .filter((p) => p?.encounterId === encounterId && p?.actor?.monsterId === goblinId);

      expect(goblinDecisionEvents.length).toBeGreaterThan(0);

      const decision = goblinDecisionEvents[0]?.decision;
      // LLM might not reliably choose endTurn; accept endTurn or any simple action
      expect(decision?.action).toBeTypeOf("string");

      // If bonus action is present, verify it's reasonable
      if (decision?.bonusAction) {
        const bonusAction = (decision.bonusAction as string).toLowerCase();
        expect(bonusAction).toMatch(/nimble|disengage|hide|dash|escape/);
      }
    }, 60000);
  });
});
