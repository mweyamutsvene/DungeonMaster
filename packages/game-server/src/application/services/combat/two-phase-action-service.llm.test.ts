/**
 * LLM Integration Tests for Two-Phase Reaction System
 * 
 * Tests real AI-vs-AI and Player reaction scenarios with LLM decision making.
 * Run with: DM_RUN_LLM_TESTS=1 pnpm test two-phase-action-service.llm.test.ts
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { nanoid } from "nanoid";
import fs from "node:fs";
import { TwoPhaseActionService } from "./two-phase-action-service.js";
import { MonsterAIService } from "./ai/monster-ai-service.js";
import { ActionService } from "./action-service.js";
import { CombatService } from "./combat-service.js";
import { InMemoryPendingActionRepository } from "../../repositories/pending-action-repository.js";
import { BasicCombatVictoryPolicy } from "./combat-victory-policy.js";
import { FactionService } from "./helpers/faction-service.js";
import { CombatantResolver } from "./helpers/combatant-resolver.js";
import { AbilityRegistry } from "./abilities/ability-registry.js";
import { NimbleEscapeExecutor, CunningActionExecutor } from "./abilities/executors/index.js";
import { LlmAiDecisionMaker } from "../../../infrastructure/llm/ai-decision-maker.js";
import {
  createLlmProviderFromEnv,
  getDefaultModelFromEnv,
} from "../../../infrastructure/llm/factory.js";
import {
  createPrismaClient,
  PrismaCombatRepository,
  PrismaCharacterRepository,
  PrismaMonsterRepository,
  PrismaNPCRepository,
  PrismaEventRepository,
  PrismaGameSessionRepository,
} from "../../../infrastructure/db/index.js";
import type { JsonValue } from "../../types.js";

// Load .env file
function loadEnvFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

loadEnvFile(".env");

const skipLlmTests = !["1", "true", "yes"].includes(process.env.DM_RUN_LLM_TESTS?.toLowerCase() || "");

// Only run when explicitly enabled. These are integration-ish (Prisma + services) and can be slower.
describe.runIf(!skipLlmTests)("Two-Phase Reaction System (Real LLM)", () => {
  let prisma: ReturnType<typeof createPrismaClient>;
  let sessionRepo: PrismaGameSessionRepository;
  let combatRepo: PrismaCombatRepository;
  let characterRepo: PrismaCharacterRepository;
  let monsterRepo: PrismaMonsterRepository;
  let npcRepo: PrismaNPCRepository;
  let eventRepo: PrismaEventRepository;
  let pendingActionRepo: InMemoryPendingActionRepository;
  let actionService: ActionService;
  let combatService: CombatService;
  let twoPhaseService: TwoPhaseActionService;
  let monsterAIService: MonsterAIService;
  let combatantResolver: CombatantResolver;
  let factionService: FactionService;
  let llmProvider: any;
  let llmModel: string;

  beforeEach(async () => {
    prisma = createPrismaClient();
    sessionRepo = new PrismaGameSessionRepository(prisma);
    combatRepo = new PrismaCombatRepository(prisma);
    characterRepo = new PrismaCharacterRepository(prisma);
    monsterRepo = new PrismaMonsterRepository(prisma);
    npcRepo = new PrismaNPCRepository(prisma);
    eventRepo = new PrismaEventRepository(prisma);
    pendingActionRepo = new InMemoryPendingActionRepository();

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
      eventRepo,
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

    twoPhaseService = new TwoPhaseActionService(
      sessionRepo,
      combatRepo,
      combatantResolver,
      pendingActionRepo,
      eventRepo
    );

    llmProvider = createLlmProviderFromEnv();
    const model = getDefaultModelFromEnv();
    if (!model) {
      throw new Error("LLM model not configured. Set DM_OLLAMA_MODEL (or equivalent) before running DM_RUN_LLM_TESTS.");
    }
    llmModel = model;

    const aiDecisionMaker = new LlmAiDecisionMaker(llmProvider, {
      model: llmModel,
      temperature: 0.0,
      seed: 42,
      timeoutMs: 60000,
    });

    const abilityRegistry = new AbilityRegistry();
    abilityRegistry.register(new NimbleEscapeExecutor());
    abilityRegistry.register(new CunningActionExecutor());

    monsterAIService = new MonsterAIService(
      combatRepo,
      characterRepo,
      monsterRepo,
      npcRepo,
      factionService,
      actionService,
      combatService,
      combatantResolver,
      abilityRegistry,
      aiDecisionMaker,
      eventRepo
    );
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  describe("AI Reaction Decisions", () => {
    it("should allow AI to decide whether to use OA reaction", async () => {
      const sessionId = nanoid();
      await sessionRepo.create({
        id: sessionId,
        storyFramework: { name: "Test Session", setting: "Test Arena" },
      });

      // Create monsters
      const goblin1 = await monsterRepo.createInSession(sessionId, {
        id: `goblin1-${Date.now()}`,
        name: "Goblin Scout",
        monsterDefinitionId: null,
        statBlock: {
          hp: 7,
          maxHp: 7,
          armorClass: 15,
          abilityScores: { strength: 8, dexterity: 14, constitution: 10, intelligence: 10, wisdom: 8, charisma: 8 },
          attacks: [{ name: "Scimitar", kind: "melee", attackBonus: 4, damage: { diceCount: 1, diceSides: 6, modifier: 2 }, damageType: "slashing", range: "melee" }],
        },
      });

      const goblin2 = await monsterRepo.createInSession(sessionId, {
        id: `goblin2-${Date.now()}`,
        name: "Goblin Guard",
        monsterDefinitionId: null,
        statBlock: {
          hp: 7,
          maxHp: 7,
          armorClass: 15,
          abilityScores: { strength: 8, dexterity: 14, constitution: 10, intelligence: 10, wisdom: 8, charisma: 8 },
          attacks: [{ name: "Scimitar", kind: "melee", attackBonus: 4, damage: { diceCount: 1, diceSides: 6, modifier: 2 }, damageType: "slashing", range: "melee" }],
        },
      });

      // Create encounter via CombatService (ensures map + resource defaults are consistent)
      const encounter = await combatService.startEncounter(sessionId, {
        combatants: [
          {
            combatantType: "Monster",
            monsterId: goblin1.id,
            initiative: 15,
            hpCurrent: 7,
            hpMax: 7,
            resources: {
              position: { x: 0, y: 0 },
              speed: 30,
              reach: 5,
              movementSpent: false,
              reactionUsed: false,
            } as JsonValue,
          },
          {
            combatantType: "Monster",
            monsterId: goblin2.id,
            initiative: 12,
            hpCurrent: 7,
            hpMax: 7,
            resources: {
              position: { x: 1, y: 0 },
              speed: 30,
              reach: 5,
              movementSpent: false,
              reactionUsed: false,
            } as JsonValue,
          },
        ],
        map: { width: 50, height: 50, gridSize: 5 },
      });

      const combatants = await combatRepo.listCombatants(encounter.id);
      const mover = combatants.find((c: any) => c.monsterId === goblin1.id) as any;
      const attacker = combatants.find((c: any) => c.monsterId === goblin2.id) as any;
      expect(mover).toBeDefined();
      expect(attacker).toBeDefined();

      const entityData = await monsterRepo.getById(goblin1.id);
      expect(entityData).toBeDefined();

      // Call the internal executor with the correct signature (this bypasses the LLM choice,
      // but exercises the reaction decision logic + ActionService integration deterministically).
      const moveResult = await (monsterAIService as any).executeMonsterAction(
        sessionId,
        encounter.id,
        entityData,
        mover,
        {
          action: "move",
          destination: { x: 10, y: 0 },
          endTurn: true,
        },
        combatants,
      );

      expect(moveResult.ok, (moveResult as any)?.summary).toBe(true);
      expect(moveResult.action).toBe("move");

      // Check if AI made a tactical decision about the OA
      // The aiReactionDecisions field should be present in the result
      const aiDecisions = (moveResult.data as any)?.aiReactionDecisions;
      expect(aiDecisions).toBeDefined();
      expect(Array.isArray(aiDecisions)).toBe(true);

      expect(aiDecisions.some((d: any) => d.attackerId === attacker.id)).toBe(true);
    }, 60000);

    it("should make different decisions based on HP", async () => {
      const sessionId = nanoid();
      await sessionRepo.create({
        id: sessionId,
        storyFramework: { name: "Test Session", setting: "Test Arena" },
      });

      // Create two scenarios: healthy AI vs low-HP AI
      const healthyGoblin = await monsterRepo.createInSession(sessionId, {
        id: `healthy-goblin-${Date.now()}`,
        name: "Healthy Goblin",
        monsterDefinitionId: null,
        statBlock: {
          hp: 7,
          maxHp: 7,
          armorClass: 15,
          speed: 30,
          abilityScores: { strength: 8, dexterity: 14, constitution: 10, intelligence: 10, wisdom: 8, charisma: 8 },
          attacks: [{ name: "Scimitar", kind: "melee", attackBonus: 4, damage: { diceCount: 1, diceSides: 6, modifier: 2 }, damageType: "slashing", range: "melee" }],
        },
      });

      const lowHpGoblin = await monsterRepo.createInSession(sessionId, {
        id: `wounded-goblin-${Date.now()}`,
        name: "Wounded Goblin",
        monsterDefinitionId: null,
        statBlock: {
          hp: 7,
          maxHp: 7,
          armorClass: 15,
          speed: 30,
          abilityScores: { strength: 8, dexterity: 14, constitution: 10, intelligence: 10, wisdom: 8, charisma: 8 },
          attacks: [{ name: "Scimitar", kind: "melee", attackBonus: 4, damage: { diceCount: 1, diceSides: 6, modifier: 2 }, damageType: "slashing", range: "melee" }],
        },
      });

      const mover = await monsterRepo.createInSession(sessionId, {
        id: `target-${Date.now()}`,
        name: "Target",
        monsterDefinitionId: null,
        statBlock: {
          hp: 7,
          maxHp: 7,
          armorClass: 15,
          speed: 30,
          abilityScores: { strength: 8, dexterity: 14, constitution: 10, intelligence: 10, wisdom: 8, charisma: 8 },
          attacks: [{ name: "Scimitar", kind: "melee", attackBonus: 4, damage: { diceCount: 1, diceSides: 6, modifier: 2 }, damageType: "slashing", range: "melee" }],
        },
      });

      const encounter = await combatService.startEncounter(sessionId, {
        combatants: [
          {
            combatantType: "Monster",
            monsterId: mover.id,
            initiative: 20,
            hpCurrent: 7,
            hpMax: 7,
            resources: {
              position: { x: 0, y: 0 },
              speed: 30,
              movementSpent: false,
            } as JsonValue,
          },
          {
            combatantType: "Monster",
            monsterId: healthyGoblin.id,
            initiative: 15,
            hpCurrent: 7,
            hpMax: 7,
            resources: {
              position: { x: 1, y: 0 },
              speed: 30,
              reach: 5,
              reactionUsed: false,
            } as JsonValue,
          },
          {
            combatantType: "Monster",
            monsterId: lowHpGoblin.id,
            initiative: 14,
            hpCurrent: 1,
            hpMax: 7,
            resources: {
              position: { x: 0, y: 1 },
              speed: 30,
              reach: 5,
              reactionUsed: false,
            } as JsonValue,
          },
        ],
        map: { width: 50, height: 50, gridSize: 5 },
      });

      const combatants = await combatRepo.listCombatants(encounter.id);
      const moverCombatant = combatants.find((c: any) => c.monsterId === mover.id) as any;
      const healthyCombatant = combatants.find((c: any) => c.monsterId === healthyGoblin.id) as any;
      const woundedCombatant = combatants.find((c: any) => c.monsterId === lowHpGoblin.id) as any;
      expect(moverCombatant).toBeDefined();
      expect(healthyCombatant).toBeDefined();
      expect(woundedCombatant).toBeDefined();

      const entityData = await monsterRepo.getById(mover.id);

      const moveResult = await (monsterAIService as any).executeMonsterAction(
        sessionId,
        encounter.id,
        entityData,
        moverCombatant,
        {
          action: "move",
          destination: { x: 10, y: 10 },
          endTurn: true,
        },
        combatants,
      );

      expect(moveResult.ok, (moveResult as any)?.summary).toBe(true);

      const aiDecisions = (moveResult.data as any)?.aiReactionDecisions;
      expect(aiDecisions).toBeDefined();
      expect(aiDecisions.length).toBeGreaterThanOrEqual(2);

      // Healthy AI should use reaction
      const healthyDecision = aiDecisions.find((d: any) => d.attackerId === healthyCombatant.id);
      expect(healthyDecision).toBeDefined();
      
      // Wounded AI (<25% HP) should decline
      const woundedDecision = aiDecisions.find((d: any) => d.attackerId === woundedCombatant.id);
      expect(woundedDecision).toBeDefined();

      expect(healthyDecision.used).toBe(true);
      expect(healthyDecision.reason).toBe("ai_used");
      expect(woundedDecision.used).toBe(false);
      expect(woundedDecision.reason).toBe("ai_declined");
    }, 60000);
  });

  describe("Player Reaction Prompts", () => {
    it("should create pending action awaiting player response", async () => {
      const sessionId = nanoid();
      await sessionRepo.create({
        id: sessionId,
        storyFramework: { name: "Test Session", setting: "Test Arena" },
      });

      // Create player character
      const player = await characterRepo.createInSession(sessionId, {
        id: `fighter-${Date.now()}`,
        name: "Fighter",
        level: 3,
        className: "fighter",
        sheet: {
          hp: 36,
          maxHp: 36,
          armorClass: 18,
          speed: 30,
          abilityScores: { strength: 16, dexterity: 14, constitution: 14, intelligence: 10, wisdom: 12, charisma: 10 },
        },
      });

      // Create enemy monster
      const goblin = await monsterRepo.createInSession(sessionId, {
        id: `goblin-${Date.now()}`,
        name: "Goblin",
        monsterDefinitionId: null,
        statBlock: {
          hp: 7,
          maxHp: 7,
          armorClass: 15,
          speed: 30,
          abilityScores: { strength: 8, dexterity: 14, constitution: 10, intelligence: 10, wisdom: 8, charisma: 8 },
          attacks: [{ name: "Scimitar", kind: "melee", attackBonus: 4, damage: { diceCount: 1, diceSides: 6, modifier: 2 }, damageType: "slashing", range: "melee" }],
        },
      });

      const encounter = await combatService.startEncounter(sessionId, {
        combatants: [
          {
            combatantType: "Character",
            characterId: player.id,
            initiative: 15,
            hpCurrent: 36,
            hpMax: 36,
            resources: {
              position: { x: 1, y: 0 },
              speed: 30,
              reach: 5,
              reactionUsed: false,
            } as JsonValue,
          },
          {
            combatantType: "Monster",
            monsterId: goblin.id,
            initiative: 10,
            hpCurrent: 7,
            hpMax: 7,
            resources: {
              position: { x: 0, y: 0 },
              speed: 30,
              movementSpent: false,
            } as JsonValue,
          },
        ],
        map: { width: 50, height: 50, gridSize: 5 },
      });

      const combatants = await combatRepo.listCombatants(encounter.id);
      const playerCombatant = combatants.find((c: any) => c.characterId === player.id) as any;
      const goblinCombatant = combatants.find((c: any) => c.monsterId === goblin.id) as any;
      expect(playerCombatant).toBeDefined();
      expect(goblinCombatant).toBeDefined();

      // Goblin moves away, triggering player OA
      const initiateResult = await twoPhaseService.initiateMove(sessionId, {
        encounterId: encounter.id,
        actor: { type: "Monster", monsterId: goblin.id },
        destination: { x: 10, y: 0 },
      });

      expect(initiateResult.status).toBe("awaiting_reactions");
      expect(initiateResult.pendingActionId).toBeDefined();
      expect(initiateResult.opportunityAttacks).toHaveLength(1);
      expect(initiateResult.opportunityAttacks[0].combatantId).toBe(playerCombatant.id);

      // Verify ReactionPrompt event was emitted
      const events = await eventRepo.listBySession(sessionId);
      const reactionPrompt = events.find(
        (e: any) => e.type === "ReactionPrompt" && (e.payload as any)?.encounterId === encounter.id,
      );
      expect(reactionPrompt).toBeDefined();
      expect((reactionPrompt?.payload as any)?.combatantId).toBe(playerCombatant.id);

      // Verify pending action exists
      const pending = await pendingActionRepo.getById(initiateResult.pendingActionId!);
      expect(pending).toBeDefined();
      expect(pending?.type).toBe("move");
      expect(pending?.reactionOpportunities).toHaveLength(1);
    }, 60000);

    it("should complete move after player responds", async () => {
      const sessionId = nanoid();
      await sessionRepo.create({
        id: sessionId,
        storyFramework: { name: "Test Session", setting: "Test Arena" },
      });

      const player = await characterRepo.createInSession(sessionId, {
        id: `fighter-${Date.now()}-2`,
        name: "Fighter",
        level: 3,
        className: "fighter",
        sheet: {
          hp: 36,
          maxHp: 36,
          armorClass: 18,
          speed: 30,
          abilityScores: { strength: 16, dexterity: 14, constitution: 14, intelligence: 10, wisdom: 12, charisma: 10 },
        },
      });

      const goblin = await monsterRepo.createInSession(sessionId, {
        id: `goblin-${Date.now()}-2`,
        name: "Goblin",
        monsterDefinitionId: null,
        statBlock: {
          hp: 7,
          maxHp: 7,
          armorClass: 15,
          speed: 30,
          abilityScores: { strength: 8, dexterity: 14, constitution: 10, intelligence: 10, wisdom: 8, charisma: 8 },
          attacks: [{ name: "Scimitar", kind: "melee", attackBonus: 4, damage: { diceCount: 1, diceSides: 6, modifier: 2 }, damageType: "slashing", range: "melee" }],
        },
      });

      const encounter = await combatService.startEncounter(sessionId, {
        combatants: [
          {
            combatantType: "Character",
            characterId: player.id,
            initiative: 15,
            hpCurrent: 36,
            hpMax: 36,
            resources: {
              position: { x: 1, y: 0 },
              speed: 30,
              reach: 5,
              reactionUsed: false,
            } as JsonValue,
          },
          {
            combatantType: "Monster",
            monsterId: goblin.id,
            initiative: 10,
            hpCurrent: 7,
            hpMax: 7,
            resources: {
              position: { x: 0, y: 0 },
              speed: 30,
              movementSpent: false,
            } as JsonValue,
          },
        ],
        map: { width: 50, height: 50, gridSize: 5 },
      });

      const combatants = await combatRepo.listCombatants(encounter.id);
      const playerCombatant = combatants.find((c: any) => c.characterId === player.id) as any;
      const goblinCombatant = combatants.find((c: any) => c.monsterId === goblin.id) as any;
      expect(playerCombatant).toBeDefined();
      expect(goblinCombatant).toBeDefined();

      // Initiate move
      const initiateResult = await twoPhaseService.initiateMove(sessionId, {
        encounterId: encounter.id,
        actor: { type: "Monster", monsterId: goblin.id },
        destination: { x: 10, y: 0 },
      });

      expect(initiateResult.status).toBe("awaiting_reactions");
      const pendingId = initiateResult.pendingActionId!;

      // Player declines OA (use the pending action's opportunity id)
      const pending = await pendingActionRepo.getById(pendingId);
      expect(pending).toBeDefined();
      const opportunityId = pending!.reactionOpportunities[0]!.id;
      await pendingActionRepo.addReactionResponse(pendingId, {
        opportunityId,
        combatantId: playerCombatant.id,
        choice: "decline",
        respondedAt: new Date(),
      });

      // Complete move
      const completeResult = await twoPhaseService.completeMove(sessionId, {
        pendingActionId: pendingId,
      });

      expect(completeResult.movedFeet).toBe(50); // coordinate delta 10 (service multiplies by 5)
      expect(completeResult.to).toEqual({ x: 10, y: 0 });

      // Verify goblin moved
      const updatedCombatants = await combatRepo.listCombatants(encounter.id);
      const updatedGoblin = updatedCombatants.find((c: any) => c.id === goblinCombatant.id);
      expect(updatedGoblin).toBeDefined();
      expect((updatedGoblin!.resources as any)?.position).toEqual({ x: 10, y: 0 });
    }, 60000);
  });
});
