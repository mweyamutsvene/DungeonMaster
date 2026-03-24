import { describe, it, expect, vi } from "vitest";
import { BattlePlanService } from "./battle-plan-service.js";
import type { BattlePlan } from "./battle-plan-types.js";
import type { CombatantStateRecord, CombatEncounterRecord } from "../../../types.js";

// ──────────────────────────────────────────────────────────────────────────────
// Test helpers
// ──────────────────────────────────────────────────────────────────────────────

function makePlan(overrides: Partial<BattlePlan> = {}): BattlePlan {
  return {
    faction: "enemy",
    generatedAtRound: 1,
    priority: "offensive",
    creatureRoles: {},
    tacticalNotes: "Attack the wizard first.",
    ...overrides,
  };
}

function makeEncounter(round: number): CombatEncounterRecord {
  return {
    id: "enc-1",
    sessionId: "s-1",
    status: "Active",
    round,
    turn: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeCombatant(id: string, hpCurrent: number, hpMax: number): CombatantStateRecord {
  return {
    id,
    encounterId: "enc-1",
    combatantType: "Monster",
    characterId: null,
    monsterId: id,
    npcId: null,
    initiative: 10,
    hpCurrent,
    hpMax,
    conditions: [],
    resources: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function makeService(): BattlePlanService {
  return new BattlePlanService(
    {} as any, // combatRepo — not used by shouldReplan
    {} as any, // factionService — not used by shouldReplan
    {} as any, // combatantResolver — not used by shouldReplan
    // no planner — not needed for shouldReplan unit tests
  );
}

/**
 * shouldReplan is private. We use `any` cast for focused unit tests of the
 * heuristic logic without replicating the full ensurePlan async wiring.
 */
function shouldReplan(
  plan: BattlePlan,
  encounter: CombatEncounterRecord,
  combatants: CombatantStateRecord[],
): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (makeService() as any).shouldReplan(plan, encounter, combatants);
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("BattlePlanService.shouldReplan()", () => {
  // ── Heuristic 1: Stale plan ─────────────────────────────────────────────────

  describe("Heuristic 1 — Stale plan (≥2 rounds old)", () => {
    it("returns true when plan is exactly 2 rounds old", () => {
      const plan = makePlan({ generatedAtRound: 1 });
      expect(shouldReplan(plan, makeEncounter(3), [])).toBe(true);
    });

    it("returns true when plan is more than 2 rounds old", () => {
      const plan = makePlan({ generatedAtRound: 1 });
      expect(shouldReplan(plan, makeEncounter(5), [])).toBe(true);
    });

    it("returns false when plan is 1 round old and no other conditions trigger", () => {
      const allyId = "ally-1";
      const plan = makePlan({
        generatedAtRound: 1,
        livingAllyIdsAtGeneration: [allyId],
        allyHpAtGeneration: { [allyId]: 30 },
        livingEnemyIdsAtGeneration: ["enemy-1"],
      });
      const combatants = [
        makeCombatant(allyId, 30, 40), // alive, minimal HP loss (0 lost)
        makeCombatant("enemy-1", 20, 20),
      ];
      expect(shouldReplan(plan, makeEncounter(2), combatants)).toBe(false);
    });

    it("returns false when plan is fresh (same round) with no other triggers", () => {
      const plan = makePlan({ generatedAtRound: 1 });
      expect(shouldReplan(plan, makeEncounter(1), [])).toBe(false);
    });
  });

  // ── Heuristic 2: Ally died ──────────────────────────────────────────────────

  describe("Heuristic 2 — Ally died since last plan", () => {
    it("returns true when a tracked ally is now dead (hpCurrent = 0)", () => {
      const plan = makePlan({
        generatedAtRound: 1,
        livingAllyIdsAtGeneration: ["ally-1", "ally-2"],
        allyHpAtGeneration: { "ally-1": 30, "ally-2": 20 },
        livingEnemyIdsAtGeneration: [],
      });
      const combatants = [
        makeCombatant("ally-1", 0, 30), // dead
        makeCombatant("ally-2", 20, 20),
      ];
      expect(shouldReplan(plan, makeEncounter(2), combatants)).toBe(true);
    });

    it("returns true when a tracked ally is at negative HP", () => {
      const plan = makePlan({
        generatedAtRound: 1,
        livingAllyIdsAtGeneration: ["ally-1"],
        allyHpAtGeneration: { "ally-1": 10 },
        livingEnemyIdsAtGeneration: [],
      });
      const combatants = [makeCombatant("ally-1", -5, 10)];
      expect(shouldReplan(plan, makeEncounter(2), combatants)).toBe(true);
    });

    it("returns false when all tracked allies are still alive", () => {
      const plan = makePlan({
        generatedAtRound: 1,
        livingAllyIdsAtGeneration: ["ally-1", "ally-2"],
        allyHpAtGeneration: { "ally-1": 30, "ally-2": 20 },
        livingEnemyIdsAtGeneration: [],
      });
      const combatants = [
        makeCombatant("ally-1", 30, 30),
        makeCombatant("ally-2", 20, 20),
      ];
      expect(shouldReplan(plan, makeEncounter(2), combatants)).toBe(false);
    });

    it("silently skips heuristic when livingAllyIdsAtGeneration is absent (backward compat)", () => {
      const plan = makePlan({ generatedAtRound: 1 }); // no snapshot fields
      const combatants = [makeCombatant("ally-1", 0, 30)];
      expect(shouldReplan(plan, makeEncounter(2), combatants)).toBe(false);
    });
  });

  // ── Heuristic 3: Significant HP loss ───────────────────────────────────────

  describe("Heuristic 3 — Ally lost >25% of max HP", () => {
    it("returns true when ally lost exactly 26% of max HP", () => {
      // hpMax=40, lost=10.4 (26%), 0.25 threshold → 10 HP threshold
      const plan = makePlan({
        generatedAtRound: 1,
        livingAllyIdsAtGeneration: ["ally-1"],
        allyHpAtGeneration: { "ally-1": 40 },
        livingEnemyIdsAtGeneration: [],
      });
      const combatants = [makeCombatant("ally-1", 29, 40)]; // lost 11 > 10 threshold
      expect(shouldReplan(plan, makeEncounter(2), combatants)).toBe(true);
    });

    it("returns true when ally lost exactly 50% HP", () => {
      const plan = makePlan({
        generatedAtRound: 1,
        livingAllyIdsAtGeneration: ["ally-1"],
        allyHpAtGeneration: { "ally-1": 40 },
        livingEnemyIdsAtGeneration: [],
      });
      const combatants = [makeCombatant("ally-1", 20, 40)]; // lost 20 = 50%
      expect(shouldReplan(plan, makeEncounter(2), combatants)).toBe(true);
    });

    it("returns false when ally lost exactly 25% HP (threshold is exclusive >)", () => {
      // threshold = REPLAN_HP_LOSS_THRESHOLD * hpMax = 0.25 * 40 = 10
      // lost = 10, condition is hpLost > 10 → false
      const plan = makePlan({
        generatedAtRound: 1,
        livingAllyIdsAtGeneration: ["ally-1"],
        allyHpAtGeneration: { "ally-1": 40 },
        livingEnemyIdsAtGeneration: [],
      });
      const combatants = [makeCombatant("ally-1", 30, 40)]; // lost exactly 10
      expect(shouldReplan(plan, makeEncounter(2), combatants)).toBe(false);
    });

    it("returns false when ally lost only 20% HP", () => {
      const plan = makePlan({
        generatedAtRound: 1,
        livingAllyIdsAtGeneration: ["ally-1"],
        allyHpAtGeneration: { "ally-1": 40 },
        livingEnemyIdsAtGeneration: [],
      });
      const combatants = [makeCombatant("ally-1", 32, 40)]; // lost 8 = 20%
      expect(shouldReplan(plan, makeEncounter(2), combatants)).toBe(false);
    });

    it("skips combatants that no longer appear in the current state", () => {
      // allyHpAtGeneration contains a stale ID not in allCombatants — should not crash
      const plan = makePlan({
        generatedAtRound: 1,
        livingAllyIdsAtGeneration: ["ally-1", "ally-2"],
        allyHpAtGeneration: { "ally-1": 40, "ally-2": 20 },
        livingEnemyIdsAtGeneration: [],
      });
      const combatants = [makeCombatant("ally-1", 38, 40)]; // ally-2 missing, ally-1 minimal loss
      expect(shouldReplan(plan, makeEncounter(2), combatants)).toBe(false);
    });

    it("silently skips heuristic when allyHpAtGeneration is absent (backward compat)", () => {
      const plan = makePlan({ generatedAtRound: 1 }); // no snapshot
      const combatants = [makeCombatant("ally-1", 1, 40)]; // huge HP loss but no snapshot
      expect(shouldReplan(plan, makeEncounter(2), combatants)).toBe(false);
    });
  });

  // ── Heuristic 4: New threat ─────────────────────────────────────────────────

  describe("Heuristic 4 — New threat entered combat", () => {
    it("returns true when an unknown living combatant appears", () => {
      const plan = makePlan({
        generatedAtRound: 1,
        livingAllyIdsAtGeneration: ["ally-1"],
        allyHpAtGeneration: { "ally-1": 30 },
        livingEnemyIdsAtGeneration: ["enemy-1"],
      });
      const combatants = [
        makeCombatant("ally-1", 30, 30),
        makeCombatant("enemy-1", 10, 10),
        makeCombatant("enemy-2", 8, 8), // reinforcement — unknown ID
      ];
      expect(shouldReplan(plan, makeEncounter(2), combatants)).toBe(true);
    });

    it("returns false when all living combatants were known at plan generation", () => {
      const plan = makePlan({
        generatedAtRound: 1,
        livingAllyIdsAtGeneration: ["ally-1"],
        allyHpAtGeneration: { "ally-1": 30 },
        livingEnemyIdsAtGeneration: ["enemy-1"],
      });
      const combatants = [
        makeCombatant("ally-1", 30, 30),
        makeCombatant("enemy-1", 10, 10),
      ];
      expect(shouldReplan(plan, makeEncounter(2), combatants)).toBe(false);
    });

    it("ignores dead unknown combatants (hpCurrent ≤ 0 does not trigger replan)", () => {
      const plan = makePlan({
        generatedAtRound: 1,
        livingAllyIdsAtGeneration: ["ally-1"],
        allyHpAtGeneration: { "ally-1": 30 },
        livingEnemyIdsAtGeneration: ["enemy-1"],
      });
      const combatants = [
        makeCombatant("ally-1", 30, 30),
        makeCombatant("enemy-1", 10, 10),
        makeCombatant("summoned-1", 0, 5), // unknown but already dead
      ];
      expect(shouldReplan(plan, makeEncounter(2), combatants)).toBe(false);
    });

    it("silently skips heuristic when either snapshot list is absent (backward compat)", () => {
      // Missing livingEnemyIdsAtGeneration → heuristic 4 skipped
      const plan = makePlan({
        generatedAtRound: 1,
        livingAllyIdsAtGeneration: ["ally-1"],
        allyHpAtGeneration: { "ally-1": 30 },
        // livingEnemyIdsAtGeneration: absent
      });
      const combatants = [
        makeCombatant("ally-1", 30, 30),
        makeCombatant("new-enemy", 20, 20), // NEW but heuristic skipped
      ];
      expect(shouldReplan(plan, makeEncounter(2), combatants)).toBe(false);
    });
  });

  // ── ensurePlan integration: snapshot is saved with plan ────────────────────

  describe("ensurePlan() — snapshot population", () => {
    it("stores battlefield snapshot when generating a new plan", async () => {
      const allyState = makeCombatant("ally-1", 30, 30);
      const enemyState = makeCombatant("enemy-1", 20, 20);

      const generatedPlan: BattlePlan = {
        faction: "ally",
        generatedAtRound: 1,
        priority: "offensive",
        creatureRoles: {},
        tacticalNotes: "Focus the wizard.",
      };

      const savedPlanRef: { value?: BattlePlan } = {};

      const service = new BattlePlanService(
        {
          getBattlePlan: vi.fn().mockResolvedValue(null), // no existing plan
          updateBattlePlan: vi.fn().mockImplementation((_enc, _faction, plan) => {
            savedPlanRef.value = plan as BattlePlan;
            return Promise.resolve();
          }),
        } as any,
        {
          getFaction: vi.fn().mockResolvedValue("ally"),
          getAllies: vi.fn().mockResolvedValue([]),
          getEnemies: vi.fn().mockResolvedValue([enemyState]),
        } as any,
        {
          getNames: vi.fn().mockResolvedValue(new Map([["ally-1", "Alice"], ["enemy-1", "Goblin"]])),
        } as any,
        {
          generatePlan: vi.fn().mockResolvedValue(generatedPlan),
        } as any,
      );

      const encounter = makeEncounter(1);
      await service.ensurePlan("enc-1", encounter, allyState, [allyState, enemyState]);

      expect(savedPlanRef.value?.livingAllyIdsAtGeneration).toContain("ally-1");
      expect(savedPlanRef.value?.livingEnemyIdsAtGeneration).toContain("enemy-1");
      expect(savedPlanRef.value?.allyHpAtGeneration?.["ally-1"]).toBe(30);
    });

    it("returns existing plan without calling planner when not stale and no triggers", async () => {
      const allyState = makeCombatant("ally-1", 30, 30);
      const existingPlan = makePlan({
        generatedAtRound: 1,
        livingAllyIdsAtGeneration: ["ally-1"],
        allyHpAtGeneration: { "ally-1": 30 },
        livingEnemyIdsAtGeneration: ["enemy-1"],
      });
      const plannerMock = { generatePlan: vi.fn() };

      const service = new BattlePlanService(
        {
          getBattlePlan: vi.fn().mockResolvedValue(existingPlan),
          updateBattlePlan: vi.fn(),
        } as any,
        { getFaction: vi.fn().mockResolvedValue("enemy") } as any,
        {} as any,
        plannerMock as any,
      );

      const encounter = makeEncounter(1); // same round as plan — not stale
      const combatants = [allyState, makeCombatant("enemy-1", 20, 20)];
      const result = await service.ensurePlan("enc-1", encounter, allyState, combatants);

      expect(plannerMock.generatePlan).not.toHaveBeenCalled();
      expect(result).toStrictEqual(existingPlan);
    });
  });
});
