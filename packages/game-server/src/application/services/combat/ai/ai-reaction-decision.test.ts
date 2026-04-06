/**
 * Unit tests for AI reaction decision logic (aiDecideReaction).
 *
 * Tests Shield intelligence: only use Shield when the attack would hit
 * without Shield but miss with it (attackTotal > AC && attackTotal <= AC + 5).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { AiTurnOrchestrator } from "./ai-turn-orchestrator.js";
import {
  MemoryCombatRepository,
  MemoryCharacterRepository,
  MemoryMonsterRepository,
  MemoryNPCRepository,
  InMemoryPendingActionRepository,
} from "../../../../infrastructure/testing/memory-repos.js";
import { FactionService } from "../helpers/faction-service.js";
import type { ICombatantResolver } from "../helpers/combatant-resolver.js";
import type { CombatantStateRecord } from "../../../types.js";
import type { ActionService } from "../action-service.js";
import type { CombatService } from "../combat-service.js";
import type { AbilityRegistry } from "../abilities/ability-registry.js";
import { TwoPhaseActionService } from "../two-phase-action-service.js";

// ============================================================================
// Test helpers
// ============================================================================

function makeCombatant(overrides: Partial<CombatantStateRecord> & { id: string }): CombatantStateRecord {
  return {
    encounterId: "enc-1",
    combatantType: "Monster",
    characterId: null,
    monsterId: "m-1",
    npcId: null,
    initiative: 15,
    hpCurrent: 20,
    hpMax: 20,
    conditions: [],
    resources: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function stubCombatantResolver(): ICombatantResolver {
  return {
    async getName() { return "Test"; },
    async getNames(combatants) {
      const map = new Map<string, string>();
      for (const c of combatants) map.set(c.id, `Combatant-${c.id}`);
      return map;
    },
    async getCombatStats() { throw new Error("Not needed"); },
    async getMonsterAttacks() { return []; },
    async getAttacks() { return []; },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("AI Reaction Decision (aiDecideReaction)", () => {
  let orchestrator: AiTurnOrchestrator;

  beforeEach(() => {
    const combat = new MemoryCombatRepository();
    const characters = new MemoryCharacterRepository();
    const monsters = new MemoryMonsterRepository();
    const npcs = new MemoryNPCRepository();
    const factionService = new FactionService({ combat, characters, monsters, npcs });
    const resolver = stubCombatantResolver();
    const pendingActions = new InMemoryPendingActionRepository();

    orchestrator = new AiTurnOrchestrator(
      combat,
      characters,
      monsters,
      npcs,
      factionService,
      {} as ActionService,          // not used by aiDecideReaction
      {} as CombatService,          // not used by aiDecideReaction
      resolver,
      {} as AbilityRegistry,        // not used by aiDecideReaction
      {} as TwoPhaseActionService,  // not used by aiDecideReaction
      pendingActions,
      undefined,                    // diceRoller
      undefined,                    // aiDecisionMaker
      undefined,                    // events
      undefined,                    // battlePlanService
    );
  });

  // Access the private method for testing via bound reference
  function getDecider() {
    return (orchestrator as any).aiDecideReaction.bind(orchestrator);
  }

  // --------------------------------------------------------------------------
  // Opportunity Attack decisions
  // --------------------------------------------------------------------------

  describe("opportunity attacks", () => {
    it("uses OA when HP is healthy", async () => {
      const decider = getDecider();
      const combatant = makeCombatant({ id: "m-1", hpCurrent: 20, hpMax: 20 });
      const result = await decider(combatant, "opportunity_attack", { targetName: "Hero" });
      expect(result).toBe(true);
    });

    it("declines OA when HP is below 25%", async () => {
      const decider = getDecider();
      const combatant = makeCombatant({ id: "m-1", hpCurrent: 4, hpMax: 20 });
      const result = await decider(combatant, "opportunity_attack", { targetName: "Hero" });
      expect(result).toBe(false);
    });

    it("uses OA at exactly 25% HP", async () => {
      const decider = getDecider();
      const combatant = makeCombatant({ id: "m-1", hpCurrent: 5, hpMax: 20 });
      const result = await decider(combatant, "opportunity_attack", { targetName: "Hero" });
      expect(result).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Shield spell decisions
  // --------------------------------------------------------------------------

  describe("shield spell intelligence", () => {
    it("uses Shield when attack would hit but Shield blocks it (AC 15, attack 17)", async () => {
      const decider = getDecider();
      const combatant = makeCombatant({ id: "m-1" });
      const result = await decider(combatant, "shield_spell", {
        attackTotal: 17,
        currentAC: 15,
      });
      expect(result).toBe(true);
    });

    it("uses Shield when attack exactly matches AC (AC 15, attack 15)", async () => {
      const decider = getDecider();
      const combatant = makeCombatant({ id: "m-1" });
      const result = await decider(combatant, "shield_spell", {
        attackTotal: 15,
        currentAC: 15,
      });
      expect(result).toBe(true);
    });

    it("uses Shield when attack is AC+4 (borderline, AC 15, attack 19)", async () => {
      const decider = getDecider();
      const combatant = makeCombatant({ id: "m-1" });
      const result = await decider(combatant, "shield_spell", {
        attackTotal: 19,
        currentAC: 15,
      });
      expect(result).toBe(true);
    });

    it("declines Shield when attack already misses (AC 15, attack 14)", async () => {
      const decider = getDecider();
      const combatant = makeCombatant({ id: "m-1" });
      const result = await decider(combatant, "shield_spell", {
        attackTotal: 14,
        currentAC: 15,
      });
      expect(result).toBe(false);
    });

    it("declines Shield when attack exceeds AC+5 (AC 15, attack 21)", async () => {
      const decider = getDecider();
      const combatant = makeCombatant({ id: "m-1" });
      const result = await decider(combatant, "shield_spell", {
        attackTotal: 21,
        currentAC: 15,
      });
      expect(result).toBe(false);
    });

    it("declines Shield at exactly AC+5 boundary (AC 15, attack 20)", async () => {
      const decider = getDecider();
      const combatant = makeCombatant({ id: "m-1" });
      // attackTotal 20 >= currentAC+5 (20), so Shield brings AC to 20 which still ties (hit)
      const result = await decider(combatant, "shield_spell", {
        attackTotal: 20,
        currentAC: 15,
      });
      // 20 < 15+5 = 20 is false, so Shield won't help
      expect(result).toBe(false);
    });

    it("uses Shield defensively when no attack info available", async () => {
      const decider = getDecider();
      const combatant = makeCombatant({ id: "m-1" });
      const result = await decider(combatant, "shield_spell", {});
      expect(result).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Counterspell decisions
  // --------------------------------------------------------------------------

  describe("counterspell", () => {
    it("always attempts Counterspell", async () => {
      const decider = getDecider();
      const combatant = makeCombatant({ id: "m-1" });
      const result = await decider(combatant, "counterspell", { spellName: "Fireball" });
      expect(result).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Other reaction type
  // --------------------------------------------------------------------------

  describe("other reactions", () => {
    it("defaults to using reaction", async () => {
      const decider = getDecider();
      const combatant = makeCombatant({ id: "m-1" });
      const result = await decider(combatant, "other", {});
      expect(result).toBe(true);
    });
  });
});
