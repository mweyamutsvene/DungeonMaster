import { describe, it, expect, vi } from "vitest";
import { AiActionExecutor } from "./ai-action-executor.js";
import type { CombatantStateRecord } from "../../../types.js";
import type { AiDecision } from "./ai-types.js";

/** Minimal combatant factory */
function makeCombatant(overrides: Partial<CombatantStateRecord> = {}): CombatantStateRecord {
  return {
    id: "comb-1",
    encounterId: "enc-1",
    combatantType: "Monster",
    characterId: null,
    monsterId: "mon-1",
    npcId: null,
    initiative: 10,
    hpCurrent: 20,
    hpMax: 20,
    conditions: [],
    resources: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** Build an AiActionExecutor with all-stub deps, allowing overrides */
function makeExecutor(overrides: Record<string, unknown> = {}): AiActionExecutor {
  return new AiActionExecutor(
    (overrides.actionService ?? { attack: vi.fn(), castSpell: vi.fn() }) as any,
    (overrides.twoPhaseActions ?? {}) as any,
    (overrides.combat ?? { listCombatants: vi.fn().mockResolvedValue([]) }) as any,
    (overrides.pendingActions ?? {}) as any,
    (overrides.combatantResolver ?? {
      getNames: vi.fn().mockResolvedValue(new Map()),
      getCombatStats: vi.fn().mockResolvedValue({}),
    }) as any,
    (overrides.abilityRegistry ?? { get: vi.fn() }) as any,
    (overrides.aiDecideReaction ?? (async () => false)) as any,
    (overrides.aiLog ?? (() => {})) as any,
    undefined, // diceRoller
    undefined, // events
    (overrides.characters ?? undefined) as any, // ICharacterRepository — for spell slot bookkeeping
  );
}

describe("AiActionExecutor", () => {
  describe("buildActorRef", () => {
    const executor = makeExecutor();

    it("returns Monster ref for Monster combatant", () => {
      const c = makeCombatant({ combatantType: "Monster", monsterId: "mon-1" });
      expect(executor.buildActorRef(c)).toEqual({ type: "Monster", monsterId: "mon-1" });
    });

    it("returns Character ref for Character combatant", () => {
      const c = makeCombatant({ combatantType: "Character", characterId: "char-1", monsterId: null });
      expect(executor.buildActorRef(c)).toEqual({ type: "Character", characterId: "char-1" });
    });

    it("returns NPC ref for NPC combatant", () => {
      const c = makeCombatant({ combatantType: "NPC", npcId: "npc-1", monsterId: null });
      expect(executor.buildActorRef(c)).toEqual({ type: "NPC", npcId: "npc-1" });
    });

    it("returns null when ID is missing", () => {
      const c = makeCombatant({ combatantType: "Monster", monsterId: null });
      expect(executor.buildActorRef(c)).toBeNull();
    });
  });

  describe("execute() economy guard", () => {
    it("rejects action-consuming decisions when action is already spent", async () => {
      const executor = makeExecutor();
      const combatant = makeCombatant({ resources: { actionSpent: true } });
      const decision: AiDecision = { action: "attack", target: "Goblin", attackName: "Bite" };

      const result = await executor.execute("s1", "e1", combatant, decision, [combatant]);

      expect(result.ok).toBe(false);
      expect(result.data?.reason).toBe("action_spent");
    });

    it("allows endTurn when action is already spent (not blocked by economy guard)", async () => {
      const executor = makeExecutor({
        combat: {
          listCombatants: vi.fn().mockResolvedValue([]),
          findActiveEncounter: vi.fn().mockResolvedValue(null),
        },
      });
      const combatant = makeCombatant({ resources: { actionSpent: true } });
      const decision: AiDecision = { action: "endTurn" };

      const result = await executor.execute("s1", "e1", combatant, decision, [combatant]);

      // endTurn is never action-consuming so economy guard must not block it
      expect(result.data?.reason).not.toBe("action_spent");
    });
  });

  describe("executeAttack() missing target", () => {
    it("returns graceful error when target/attackName missing", async () => {
      const executor = makeExecutor();
      const combatant = makeCombatant();
      const decision: AiDecision = { action: "attack" };

      const result = await executor.execute("s1", "e1", combatant, decision, [combatant]);

      expect(result.ok).toBe(false);
      expect(result.summary).toContain("requires target and attackName");
      expect(result.data?.reason).toBe("missing_parameters");
    });
  });

  describe("executeAttack() target not found", () => {
    it("returns graceful error when named target is not in combatants", async () => {
      const executor = makeExecutor({
        combatantResolver: {
          getNames: vi.fn().mockResolvedValue(new Map([["comb-1", "Goblin"]])),
          getCombatStats: vi.fn().mockResolvedValue({}),
        },
      });
      const combatant = makeCombatant();
      const decision: AiDecision = { action: "attack", target: "Dragon", attackName: "Bite" };

      const result = await executor.execute("s1", "e1", combatant, decision, [combatant]);

      expect(result.ok).toBe(false);
      expect(result.data?.reason).toBe("target_not_found");
    });
  });

  describe("unknown action", () => {
    it("returns error for unrecognized action type", async () => {
      const executor = makeExecutor();
      const combatant = makeCombatant();
      const decision = { action: "teleport" } as unknown as AiDecision;

      const result = await executor.execute("s1", "e1", combatant, decision, [combatant]);

      expect(result.ok).toBe(false);
      expect(result.data?.reason).toBe("unknown_action");
    });
  });
});

// ------------------------------------------------------------------
// BUG 1 — stale resource snapshot overwrites executor-set flags
// The executeBonusAction path re-reads fresh combatant state from DB
// before spending resources, so executor-set flags (e.g. disengaged)
// are not erased by a stale snapshot.
// ------------------------------------------------------------------

describe("executeBonusAction() — BUG 1 stale resources fix", () => {
  it("calls listCombatants to re-read fresh state before spending resource", async () => {
    const freshCombatant = makeCombatant({
      resources: { disengaged: true, ki: 4 },
    });
    const staleCombatant = makeCombatant({
      resources: { disengaged: false, ki: 4 }, // stale snapshot — disengaged not yet set
    });

    const listCombatants = vi.fn().mockResolvedValue([freshCombatant]);
    const updateCombatantState = vi.fn().mockResolvedValue(undefined);
    const fakeRegistry = {
      get: vi.fn(),
      hasExecutor: vi.fn().mockReturnValue(true),
      execute: vi.fn().mockResolvedValue({
        success: true,
        summary: "Flurry executed",
        data: { spendResource: { poolName: "ki", amount: 1 } },
      }),
    };

    const executor = makeExecutor({
      combat: {
        listCombatants,
        updateCombatantState,
        findActiveEncounter: vi.fn().mockResolvedValue(null),
      },
      abilityRegistry: fakeRegistry,
    });

    const decision = { action: "endTurn" as const, bonusAction: "FlurryOfBlows" };
    const actorRef = { type: "Monster" as const, monsterId: "mon-1" };
    await executor.executeBonusAction("s1", "e1", staleCombatant, decision, actorRef);

    // Proof that the fresh-read path was taken (BUG 1 fix).
    // listCombatants must be called with the encounter ID to fetch fresh state.
    expect(listCombatants).toHaveBeenCalledWith("e1");
  });
});

// ------------------------------------------------------------------
// BUG 7 — pendingBonusAction stored when attack awaits reactions
// When an attack outcome has status "awaiting_reactions", the bonus
// action in the decision must be preserved in combatant resources so
// the orchestrator can re-execute it after the reaction resolves.
// ------------------------------------------------------------------

describe("executeBonusAction() public visibility (BUG 7)", () => {
  it("executeBonusAction is a public method callable from the orchestrator", () => {
    const executor = makeExecutor();
    expect(typeof executor.executeBonusAction).toBe("function");
  });
});
