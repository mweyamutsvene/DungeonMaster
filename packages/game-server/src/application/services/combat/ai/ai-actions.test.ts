import { describe, it, expect, beforeEach, vi } from "vitest";
import { MonsterAIService } from "./monster-ai-service.js";
import { ActionService } from "../action-service.js";
import { CombatService } from "../combat-service.js";
import { FactionService } from "../helpers/faction-service.js";
import { AbilityRegistry } from "../abilities/ability-registry.js";
import { NimbleEscapeExecutor, CunningActionExecutor } from "../abilities/executors/index.js";
import type { IAiDecisionMaker, AiDecision } from "./ai-decision-maker.js";
import type { ICombatRepository, ICharacterRepository, IMonsterRepository, INPCRepository, IEventRepository } from "../../../repositories/index.js";
import type { ICombatantResolver } from "../helpers/combatant-resolver.js";
import type { CombatEncounterRecord, CombatantStateRecord } from "../../../types.js";

/**
 * AI Action Tests
 * 
 * Tests individual AI actions in isolation with mock LLM responses.
 * Each test focuses on a specific action type to verify:
 * - LLM decision is correctly parsed
 * - Action is executed with correct parameters
 * - Results are properly returned
 * - Events are emitted
 */

describe("AI Actions (Mock LLM)", () => {
  let mockAiDecisionMaker: IAiDecisionMaker;
  let mockCombatRepo: ICombatRepository;
  let mockCharRepo: ICharacterRepository;
  let mockMonsterRepo: IMonsterRepository;
  let mockNPCRepo: INPCRepository;
  let mockEventRepo: IEventRepository;
  let mockCombatantResolver: ICombatantResolver;
  let mockFactionService: FactionService;
  let mockActionService: ActionService;
  let mockCombatService: CombatService;
  let monsterAIService: MonsterAIService;

  // Sample encounter and combatant data
  const mockEncounter: CombatEncounterRecord = {
    id: "test-encounter",
    sessionId: "test-session",
    status: "Active",
    round: 1,
    turn: 0,
    mapData: {
      id: "test-map",
      name: "Test Arena",
      width: 50,
      height: 50,
      gridSize: 5,
      cells: [],
      entities: [],
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockGoblin: CombatantStateRecord = {
    id: "goblin-1",
    encounterId: "test-encounter",
    combatantType: "Monster",
    characterId: null,
    monsterId: "monster-goblin-1",
    npcId: null,
    monster: { faction: "goblins", aiControlled: true },
    initiative: 15,
    hpCurrent: 7,
    hpMax: 7,
    conditions: [],
    resources: { position: { x: 40, y: 25 }, speed: 30 },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockFighter: CombatantStateRecord = {
    id: "fighter-1",
    encounterId: "test-encounter",
    combatantType: "Character",
    characterId: "char-fighter-1",
    monsterId: null,
    npcId: null,
    character: { faction: "heroes", aiControlled: false },
    initiative: 20,
    hpCurrent: 36,
    hpMax: 36,
    conditions: [],
    resources: { position: { x: 10, y: 25 }, speed: 30 },
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    // Mock AI decision maker with controllable responses
    mockAiDecisionMaker = {
      decide: vi.fn(),
    };

    // Mock repositories
    mockCombatRepo = {
      getEncounterById: vi.fn().mockResolvedValue(mockEncounter),
      listCombatants: vi.fn().mockResolvedValue([mockGoblin, mockFighter]),
      updateCombatantState: vi.fn().mockResolvedValue(mockGoblin),
    } as any;

    mockMonsterRepo = {
      getById: vi.fn().mockResolvedValue({
        id: "monster-goblin-1",
        name: "Goblin",
        faction: "goblins",
        aiControlled: true,
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
          bonusActions: [
            {
              name: "Nimble Escape",
              description: "Disengage or Hide as a bonus action",
            },
          ],
        },
      }),
    } as any;

    mockCharRepo = {
      getById: vi.fn().mockResolvedValue({
        id: "char-fighter-1",
        name: "Fighter",
        faction: "heroes",
        className: "fighter",
        level: 3,
        sheet: {
          hp: 36,
          maxHp: 36,
          armorClass: 16,
          abilityScores: {
            strength: 16,
            dexterity: 10,
            constitution: 14,
            intelligence: 10,
            wisdom: 12,
            charisma: 8,
          },
        },
      }),
    } as any;

    mockNPCRepo = {} as any;
    mockEventRepo = {
      append: vi.fn().mockResolvedValue(undefined),
    } as any;

    mockCombatantResolver = {
      getNames: vi.fn().mockResolvedValue(
        new Map([
          ["fighter-1", "Fighter"],
          ["goblin-1", "Goblin"],
        ])
      ),
    } as any;

    mockFactionService = {
      isAIControlled: vi.fn().mockResolvedValue(true),
      getAllies: vi.fn().mockResolvedValue([]),
      getEnemies: vi.fn().mockResolvedValue([mockFighter]),
    } as any;

    mockEventRepo = {
      emit: vi.fn(),
      listBySession: vi.fn().mockResolvedValue([]),
      append: vi.fn(),
    } as any;

    mockActionService = {
      attack: vi.fn().mockResolvedValue({
        actor: mockGoblin,
        result: {
          hit: true,
          critical: false,
          attack: { d20: 15, total: 19 },
          damage: { roll: { total: 6 }, applied: 6 },
        },
      }),
      move: vi.fn().mockResolvedValue({
        actor: mockGoblin,
        result: {
          from: { x: 40, y: 25 },
          to: { x: 20, y: 25 },
          movedFeet: 20,
          opportunityAttacks: [],
        },
        opportunityAttacks: [],
      }),
      dodge: vi.fn().mockResolvedValue({ actor: mockGoblin }),
      dash: vi.fn().mockResolvedValue({ actor: mockGoblin }),
      disengage: vi.fn().mockResolvedValue({ actor: mockGoblin }),
      help: vi.fn().mockResolvedValue({ actor: mockGoblin }),
      castSpell: vi.fn().mockResolvedValue({ actor: mockGoblin }),
      shove: vi.fn().mockResolvedValue({
        actor: mockGoblin,
        target: mockFighter,
        result: { success: true, shoveType: "push", attackerRoll: 15, targetRoll: 10, pushedTo: { x: 15, y: 25 } },
      }),
    } as any;

    mockCombatService = {
      nextTurn: vi.fn().mockResolvedValue(undefined),
    } as any;

    const abilityRegistry = new AbilityRegistry();
    abilityRegistry.register(new NimbleEscapeExecutor());
    abilityRegistry.register(new CunningActionExecutor());

    monsterAIService = new MonsterAIService(
      mockCombatRepo,
      mockCharRepo,
      mockMonsterRepo,
      mockNPCRepo,
      mockFactionService,
      mockActionService,
      mockCombatService,
      mockCombatantResolver,
      abilityRegistry,
      mockAiDecisionMaker,
      mockEventRepo
    );
  });

  describe("Attack Action", () => {
    it("should execute melee attack when AI decides to attack", async () => {
      const attackDecision: AiDecision = {
        action: "attack",
        target: "Fighter",
        attackName: "Scimitar",
        intentNarration: "The goblin lunges at the fighter with its scimitar!",
      };

      vi.mocked(mockAiDecisionMaker.decide).mockResolvedValue(attackDecision);

      await monsterAIService.processMonsterTurnIfNeeded("test-session", "test-encounter");

      expect(mockActionService.attack).toHaveBeenCalledWith(
        "test-session",
        expect.objectContaining({
          encounterId: "test-encounter",
          attacker: { type: "Monster", monsterId: "monster-goblin-1" },
          target: { type: "Character", characterId: "char-fighter-1" },
          monsterAttackName: "Scimitar",
        })
      );

      expect(mockCombatService.nextTurn).toHaveBeenCalled();
    });

    it("should emit intent narration before attack", async () => {
      const attackDecision: AiDecision = {
        action: "attack",
        target: "Fighter",
        attackName: "Scimitar",
        intentNarration: "The goblin lunges with deadly intent!",
      };

      vi.mocked(mockAiDecisionMaker.decide).mockResolvedValue(attackDecision);

      await monsterAIService.processMonsterTurnIfNeeded("test-session", "test-encounter");

      expect(mockEventRepo.append).toHaveBeenCalledWith(
        "test-session",
        expect.objectContaining({
          type: "NarrativeText",
          payload: expect.objectContaining({
            text: "The goblin lunges with deadly intent!",
          }),
        })
      );
    });
  });

  describe("Move Action", () => {
    it("should execute move when AI decides to reposition", async () => {
      const moveDecision: AiDecision = {
        action: "move",
        destination: { x: 20, y: 25 },
        intentNarration: "The goblin darts forward to close the distance!",
      };

      vi.mocked(mockAiDecisionMaker.decide).mockResolvedValue(moveDecision);

      await monsterAIService.processMonsterTurnIfNeeded("test-session", "test-encounter");

      expect(mockActionService.move).toHaveBeenCalledWith(
        "test-session",
        expect.objectContaining({
          encounterId: "test-encounter",
          actor: { type: "Monster", monsterId: "monster-goblin-1" },
          destination: { x: 20, y: 25 },
        })
      );

      expect(mockCombatService.nextTurn).toHaveBeenCalled();
    });

    it("should handle opportunity attacks triggered by movement", async () => {
      const moveDecision: AiDecision = {
        action: "move",
        destination: { x: 20, y: 25 },
        intentNarration: "The goblin tries to flee!",
      };

      vi.mocked(mockAiDecisionMaker.decide).mockResolvedValue(moveDecision);
      vi.mocked(mockActionService.move).mockResolvedValue({
        actor: mockGoblin,
        result: {
          from: { x: 40, y: 25 },
          to: { x: 20, y: 25 },
          movedFeet: 20,
          opportunityAttacks: [
            {
              attackerId: "fighter-1",
              targetId: "goblin-1",
              result: { hit: true, damage: { applied: 8 } },
            },
          ],
        },
        opportunityAttacks: [
          {
            attackerId: "fighter-1",
            targetId: "goblin-1",
            canAttack: true,
            hasReaction: false,
          },
        ],
      });

      await monsterAIService.processMonsterTurnIfNeeded("test-session", "test-encounter");

      expect(mockActionService.move).toHaveBeenCalled();
      expect(mockCombatService.nextTurn).toHaveBeenCalled();
    });
  });

  describe("Battlefield Awareness", () => {
    it("should provide battlefield context to AI with positions", async () => {
      vi.mocked(mockAiDecisionMaker.decide).mockImplementation(async (input) => {
        const ctx = input.context as any;
        // Verify battlefield is provided
        expect(ctx.battlefield).toBeDefined();
        expect(ctx.battlefield?.grid).toBeDefined();
        expect(ctx.battlefield?.legend).toBeDefined();

        // Verify positions are included
        expect(ctx.combatant.position).toEqual({ x: 40, y: 25 });
        expect(ctx.enemies[0]?.position).toEqual({ x: 10, y: 25 });

        return {
          action: "attack",
          target: "Fighter",
          attackName: "Scimitar",
        };
      });

      await monsterAIService.processMonsterTurnIfNeeded("test-session", "test-encounter");

      expect(mockAiDecisionMaker.decide).toHaveBeenCalled();
    });
  });

  describe("Defensive Actions", () => {
    it("should execute disengage action", async () => {
      const disengageDecision: AiDecision = {
        action: "disengage" as any,
        intentNarration: "The goblin disengages from combat!",
      };

      vi.mocked(mockAiDecisionMaker.decide).mockResolvedValue(disengageDecision);

      await monsterAIService.processMonsterTurnIfNeeded("test-session", "test-encounter");

      expect((mockActionService as any).disengage).toHaveBeenCalledWith(
        "test-session",
        expect.objectContaining({
          encounterId: "test-encounter",
          actor: { type: "Monster", monsterId: "monster-goblin-1" },
        }),
      );
      expect(mockCombatService.nextTurn).toHaveBeenCalled();
    });

    it("should execute dash action", async () => {
      const dashDecision: AiDecision = {
        action: "dash" as any,
        intentNarration: "The goblin dashes forward!",
      };

      vi.mocked(mockAiDecisionMaker.decide).mockResolvedValue(dashDecision);

      await monsterAIService.processMonsterTurnIfNeeded("test-session", "test-encounter");

      expect((mockActionService as any).dash).toHaveBeenCalledWith(
        "test-session",
        expect.objectContaining({
          encounterId: "test-encounter",
          actor: { type: "Monster", monsterId: "monster-goblin-1" },
        }),
      );
      expect(mockCombatService.nextTurn).toHaveBeenCalled();
    });

    it("should execute dodge action", async () => {
      const dodgeDecision: AiDecision = {
        action: "dodge" as any,
        intentNarration: "The goblin takes a defensive stance!",
      };

      vi.mocked(mockAiDecisionMaker.decide).mockResolvedValue(dodgeDecision);

      await monsterAIService.processMonsterTurnIfNeeded("test-session", "test-encounter");

      expect((mockActionService as any).dodge).toHaveBeenCalledWith(
        "test-session",
        expect.objectContaining({
          encounterId: "test-encounter",
          actor: { type: "Monster", monsterId: "monster-goblin-1" },
        }),
      );
      expect(mockCombatService.nextTurn).toHaveBeenCalled();
    });
  });

  describe("Special Actions", () => {
    it("should gracefully handle unimplemented grapple action", async () => {
      const grappleDecision: AiDecision = {
        action: "grapple" as any,
        target: "Fighter",
        intentNarration: "The goblin attempts to grapple the fighter!",
      };

      vi.mocked(mockAiDecisionMaker.decide).mockResolvedValue(grappleDecision);

      await monsterAIService.processMonsterTurnIfNeeded("test-session", "test-encounter");

      // Grapple isn't implemented yet in MonsterAIService's executor.
      expect((mockActionService as any).attack).not.toHaveBeenCalled();
      expect((mockActionService as any).move).not.toHaveBeenCalled();
      expect((mockActionService as any).dash).not.toHaveBeenCalled();
      expect((mockActionService as any).disengage).not.toHaveBeenCalled();
      expect((mockActionService as any).dodge).not.toHaveBeenCalled();
      expect((mockActionService as any).help).not.toHaveBeenCalled();
      expect((mockActionService as any).castSpell).not.toHaveBeenCalled();
      expect((mockActionService as any).shove).not.toHaveBeenCalled();
      expect(mockCombatService.nextTurn).toHaveBeenCalled();
    });

    it("should execute shove action", async () => {
      const shoveDecision: AiDecision = {
        action: "shove" as any,
        target: "Fighter",
        intentNarration: "The goblin shoves the fighter!",
      };

      vi.mocked(mockAiDecisionMaker.decide).mockResolvedValue(shoveDecision);

      await monsterAIService.processMonsterTurnIfNeeded("test-session", "test-encounter");

      expect((mockActionService as any).shove).toHaveBeenCalledWith(
        "test-session",
        expect.objectContaining({
          encounterId: "test-encounter",
          actor: { type: "Monster", monsterId: "monster-goblin-1" },
          target: { type: "Character", characterId: "char-fighter-1" },
        }),
      );
      expect(mockCombatService.nextTurn).toHaveBeenCalled();
    });

    it("should execute hide action", async () => {
      const hideDecision: AiDecision = {
        action: "hide" as any,
        intentNarration: "The goblin attempts to hide!",
      };

      vi.mocked(mockAiDecisionMaker.decide).mockResolvedValue(hideDecision);

      await monsterAIService.processMonsterTurnIfNeeded("test-session", "test-encounter");

      expect(mockCombatService.nextTurn).toHaveBeenCalled();
    });

    it("should execute search action", async () => {
      const searchDecision: AiDecision = {
        action: "search" as any,
        intentNarration: "The goblin searches the area!",
      };

      vi.mocked(mockAiDecisionMaker.decide).mockResolvedValue(searchDecision);

      await monsterAIService.processMonsterTurnIfNeeded("test-session", "test-encounter");

      expect(mockCombatService.nextTurn).toHaveBeenCalled();
    });

    it("should execute use-object action", async () => {
      const useObjectDecision: AiDecision = {
        action: "useObject" as any,
        target: "Door",
        intentNarration: "The goblin opens the door!",
      };

      vi.mocked(mockAiDecisionMaker.decide).mockResolvedValue(useObjectDecision);

      await monsterAIService.processMonsterTurnIfNeeded("test-session", "test-encounter");

      expect(mockCombatService.nextTurn).toHaveBeenCalled();
    });

    it("should allow chaining shove then move in one AI turn", async () => {
      const shoveDecision: AiDecision = {
        action: "shove" as any,
        target: "Fighter",
        intentNarration: "The goblin shoves the fighter back!",
        endTurn: false,
      };

      const moveDecision: AiDecision = {
        action: "move",
        destination: { x: 30, y: 25 },
        intentNarration: "The goblin retreats behind cover!",
        endTurn: true,
      };

      vi.mocked(mockAiDecisionMaker.decide)
        .mockResolvedValueOnce(shoveDecision)
        .mockResolvedValueOnce(moveDecision);

      await monsterAIService.processMonsterTurnIfNeeded("test-session", "test-encounter");

      expect((mockActionService as any).shove).toHaveBeenCalledWith(
        "test-session",
        expect.objectContaining({
          encounterId: "test-encounter",
          actor: { type: "Monster", monsterId: "monster-goblin-1" },
          target: { type: "Character", characterId: "char-fighter-1" },
        }),
      );

      expect(mockActionService.move).toHaveBeenCalledWith(
        "test-session",
        expect.objectContaining({
          encounterId: "test-encounter",
          actor: { type: "Monster", monsterId: "monster-goblin-1" },
          destination: { x: 30, y: 25 },
        }),
      );

      expect(mockCombatService.nextTurn).toHaveBeenCalled();
    });
  });

  describe("Simple Action Execution", () => {
    it("should execute help action", async () => {
      const helpDecision: AiDecision = {
        action: "help" as any,
        target: "Fighter",
        intentNarration: "The goblin tries to distract the fighter for an ally!",
      };

      vi.mocked(mockAiDecisionMaker.decide).mockResolvedValue(helpDecision);

      await monsterAIService.processMonsterTurnIfNeeded("test-session", "test-encounter");

      expect((mockActionService as any).help).toHaveBeenCalledWith(
        "test-session",
        expect.objectContaining({
          encounterId: "test-encounter",
          actor: { type: "Monster", monsterId: "monster-goblin-1" },
          target: { type: "Character", characterId: "char-fighter-1" },
        }),
      );
      expect(mockCombatService.nextTurn).toHaveBeenCalled();
    });

    it("should execute castSpell action", async () => {
      const castSpellDecision: AiDecision = {
        action: "castSpell" as any,
        spellName: "Magic Missile",
        intentNarration: "The goblin mutters an incantation and unleashes a spell!",
      };

      vi.mocked(mockAiDecisionMaker.decide).mockResolvedValue(castSpellDecision);

      await monsterAIService.processMonsterTurnIfNeeded("test-session", "test-encounter");

      expect((mockActionService as any).castSpell).toHaveBeenCalledWith(
        "test-session",
        expect.objectContaining({
          encounterId: "test-encounter",
          actor: { type: "Monster", monsterId: "monster-goblin-1" },
          spellName: "Magic Missile",
        }),
      );
      expect(mockCombatService.nextTurn).toHaveBeenCalled();
    });

    it("should treat endTurn as a no-op and advance turn", async () => {
      const endTurnDecision: AiDecision = {
        action: "endTurn" as any,
        intentNarration: "The goblin hesitates and does nothing this moment.",
      };

      vi.mocked(mockAiDecisionMaker.decide).mockResolvedValue(endTurnDecision);

      await monsterAIService.processMonsterTurnIfNeeded("test-session", "test-encounter");

      expect((mockActionService as any).attack).not.toHaveBeenCalled();
      expect((mockActionService as any).move).not.toHaveBeenCalled();
      expect((mockActionService as any).dash).not.toHaveBeenCalled();
      expect((mockActionService as any).disengage).not.toHaveBeenCalled();
      expect((mockActionService as any).dodge).not.toHaveBeenCalled();
      expect((mockActionService as any).help).not.toHaveBeenCalled();
      expect((mockActionService as any).castSpell).not.toHaveBeenCalled();
      expect((mockActionService as any).shove).not.toHaveBeenCalled();
      expect(mockCombatService.nextTurn).toHaveBeenCalled();
    });
  });

  describe("LLM Failure Handling", () => {
    it("should gracefully handle when LLM returns null decision", async () => {
      vi.mocked(mockAiDecisionMaker.decide).mockResolvedValue(null);

      await monsterAIService.processMonsterTurnIfNeeded("test-session", "test-encounter");

      // Should advance turn even without decision
      expect(mockCombatService.nextTurn).toHaveBeenCalled();
    });

    it("should skip turn for downed combatants", async () => {
      const downedGoblin = { ...mockGoblin, hpCurrent: 0 };
      vi.mocked(mockCombatRepo.listCombatants).mockResolvedValue([downedGoblin, mockFighter]);

      await monsterAIService.processMonsterTurnIfNeeded("test-session", "test-encounter");

      // Should not call AI decision maker for downed combatant
      expect(mockAiDecisionMaker.decide).not.toHaveBeenCalled();
      expect(mockCombatService.nextTurn).toHaveBeenCalled();
    });
  });

  describe("Bonus Actions", () => {
    it("should execute Nimble Escape (disengage) as bonus action with attack", async () => {
      const attackWithBonusDecision: AiDecision = {
        action: "attack",
        target: "Fighter",
        attackName: "Scimitar",
        bonusAction: "nimble_escape_disengage",
        intentNarration: "The goblin slashes with its scimitar, then deftly dodges away!",
      };

      vi.mocked(mockAiDecisionMaker.decide).mockResolvedValue(attackWithBonusDecision);

      await monsterAIService.processMonsterTurnIfNeeded("test-session", "test-encounter");

      // Should execute main attack
      expect(mockActionService.attack).toHaveBeenCalledWith(
        "test-session",
        expect.objectContaining({
          encounterId: "test-encounter",
          attacker: { type: "Monster", monsterId: "monster-goblin-1" },
          target: { type: "Character", characterId: "char-fighter-1" },
          monsterAttackName: "Scimitar",
        }),
      );

      // Should execute bonus action (disengage)
      expect((mockActionService as any).disengage).toHaveBeenCalledWith(
        "test-session",
        expect.objectContaining({
          encounterId: "test-encounter",
          actor: { type: "Monster", monsterId: "monster-goblin-1" },
        }),
      );

      expect(mockCombatService.nextTurn).toHaveBeenCalled();
    });

    it("should execute Nimble Escape (hide) as bonus action with move", async () => {
      const moveWithBonusDecision: AiDecision = {
        action: "move",
        destination: { x: 45, y: 30 },
        bonusAction: "nimble_escape_hide",
        intentNarration: "The goblin scurries to cover and attempts to hide!",
      };

      vi.mocked(mockAiDecisionMaker.decide).mockResolvedValue(moveWithBonusDecision);

      await monsterAIService.processMonsterTurnIfNeeded("test-session", "test-encounter");

      // Should execute movement
      expect(mockActionService.move).toHaveBeenCalledWith(
        "test-session",
        expect.objectContaining({
          encounterId: "test-encounter",
          actor: { type: "Monster", monsterId: "monster-goblin-1" },
          destination: { x: 45, y: 30 },
        }),
      );

      // Hide is not fully implemented, so it should be gracefully handled
      // (no expectation for hide call, but should not throw)
      expect(mockCombatService.nextTurn).toHaveBeenCalled();
    });

    it("should execute Cunning Action (dash) as bonus action with attack", async () => {
      const attackWithCunningDecision: AiDecision = {
        action: "attack",
        target: "Fighter",
        attackName: "Scimitar",
        bonusAction: "cunning_action_dash",
        intentNarration: "The rogue strikes quickly, gaining extra mobility!",
      };

      vi.mocked(mockAiDecisionMaker.decide).mockResolvedValue(attackWithCunningDecision);

      await monsterAIService.processMonsterTurnIfNeeded("test-session", "test-encounter");

      expect(mockActionService.attack).toHaveBeenCalled();
      expect((mockActionService as any).dash).toHaveBeenCalledWith(
        "test-session",
        expect.objectContaining({
          encounterId: "test-encounter",
          actor: { type: "Monster", monsterId: "monster-goblin-1" },
        }),
      );
      expect(mockCombatService.nextTurn).toHaveBeenCalled();
    });

    it("should allow bonus action even when only using endTurn", async () => {
      const endTurnWithBonusDecision: AiDecision = {
        action: "endTurn",
        bonusAction: "nimble_escape_disengage",
        intentNarration: "The goblin prepares to escape, disengaging without attacking!",
      };

      vi.mocked(mockAiDecisionMaker.decide).mockResolvedValue(endTurnWithBonusDecision);

      await monsterAIService.processMonsterTurnIfNeeded("test-session", "test-encounter");

      // Should execute bonus action even though main action is endTurn
      expect((mockActionService as any).disengage).toHaveBeenCalledWith(
        "test-session",
        expect.objectContaining({
          encounterId: "test-encounter",
          actor: { type: "Monster", monsterId: "monster-goblin-1" },
        }),
      );

      expect(mockCombatService.nextTurn).toHaveBeenCalled();
    });

    it("should handle bonus actions with shove", async () => {
      const shoveWithBonusDecision: AiDecision = {
        action: "shove",
        target: "Fighter",
        bonusAction: "nimble_escape_disengage",
        intentNarration: "The goblin shoves the fighter, then disengages!",
      };

      vi.mocked(mockAiDecisionMaker.decide).mockResolvedValue(shoveWithBonusDecision);

      await monsterAIService.processMonsterTurnIfNeeded("test-session", "test-encounter");

      expect((mockActionService as any).shove).toHaveBeenCalledWith(
        "test-session",
        expect.objectContaining({
          encounterId: "test-encounter",
          actor: { type: "Monster", monsterId: "monster-goblin-1" },
          target: { type: "Character", characterId: "char-fighter-1" },
        }),
      );

      expect((mockActionService as any).disengage).toHaveBeenCalledWith(
        "test-session",
        expect.objectContaining({
          encounterId: "test-encounter",
          actor: { type: "Monster", monsterId: "monster-goblin-1" },
        }),
      );

      expect(mockCombatService.nextTurn).toHaveBeenCalled();
    });
  });
});
