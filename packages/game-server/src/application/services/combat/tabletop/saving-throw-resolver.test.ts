import { beforeEach, describe, expect, it } from "vitest";
import { SavingThrowResolver } from "./saving-throw-resolver.js";
import { MemoryCombatRepository } from "../../../../infrastructure/testing/memory-repos.js";
import { FixedDiceRoller } from "../../../../domain/rules/dice-roller.js";
import type { SavingThrowPendingAction } from "./tabletop-types.js";

describe("SavingThrowResolver", () => {
  let combatRepo: MemoryCombatRepository;
  const encounterId = "enc-1";
  const sessionId = "sess-1";
  const monsterId = "goblin-1";
  const sourceId = "wizard-1";

  // Goblin with DEX 14 (+2 mod), no save proficiencies, level 1
  const goblinMonster = {
    id: monsterId,
    statBlock: {
      abilityScores: { strength: 8, dexterity: 14, constitution: 10, intelligence: 10, wisdom: 8, charisma: 8 },
      saveProficiencies: [] as string[],
      level: 1,
    },
  };

  // Wizard with WIS 12 (+1 mod), wisdom_save proficiency, level 5
  const wizardCharacter = {
    id: sourceId,
    sheet: {
      abilityScores: { strength: 8, dexterity: 10, constitution: 12, intelligence: 16, wisdom: 12, charisma: 10 },
      saveProficiencies: ["wisdom_save"],
      level: 5,
    },
  };

  function makeAction(overrides: Partial<SavingThrowPendingAction> = {}): SavingThrowPendingAction {
    return {
      type: "SAVING_THROW",
      timestamp: new Date(),
      actorId: monsterId,
      sourceId,
      ability: "dexterity",
      dc: 15,
      reason: "Burning Hands",
      onSuccess: { summary: "Half damage" },
      onFailure: { summary: "Full damage" },
      ...overrides,
    };
  }

  beforeEach(async () => {
    combatRepo = new MemoryCombatRepository();
    await combatRepo.createEncounter(sessionId, {
      id: encounterId,
      status: "Active",
      round: 1,
      turn: 0,
    });
    // Create combatant for the goblin (target)
    await combatRepo.createCombatants(encounterId, [
      {
        id: "cbt-goblin",
        combatantType: "Monster",
        characterId: null,
        monsterId,
        npcId: null,
        initiative: 10,
        hpCurrent: 7,
        hpMax: 7,
        conditions: [],
        resources: {},
      },
    ]);
  });

  describe("DEX save with cover bonus", () => {
    it("should include cover bonus in modifier for DEX saves", async () => {
      // Fixed d20 roll of 10: total = 10 + 2 (DEX mod) + 2 (cover) = 14, vs DC 15 → failure
      const diceRoller = new FixedDiceRoller(10);
      const resolver = new SavingThrowResolver(combatRepo, diceRoller);

      const action = makeAction({
        ability: "dexterity",
        dc: 15,
        context: { coverBonus: 2, coverLevel: "half" },
      });

      const resolution = await resolver.resolve(
        action,
        encounterId,
        [],
        [goblinMonster],
        [],
      );

      // DEX mod (+2) + cover bonus (+2) = +4 total modifier
      expect(resolution.modifier).toBe(4);
      expect(resolution.coverBonus).toBe(2);
      // 10 + 4 = 14 vs DC 15 → failure
      expect(resolution.total).toBe(14);
      expect(resolution.success).toBe(false);
    });

    it("should succeed when cover bonus pushes total past DC", async () => {
      // Fixed d20 roll of 11: total = 11 + 2 (DEX mod) + 2 (cover) = 15, vs DC 15 → success
      const diceRoller = new FixedDiceRoller(11);
      const resolver = new SavingThrowResolver(combatRepo, diceRoller);

      const action = makeAction({
        ability: "dexterity",
        dc: 15,
        context: { coverBonus: 2, coverLevel: "half" },
      });

      const resolution = await resolver.resolve(
        action,
        encounterId,
        [],
        [goblinMonster],
        [],
      );

      expect(resolution.modifier).toBe(4);
      expect(resolution.coverBonus).toBe(2);
      expect(resolution.total).toBe(15);
      expect(resolution.success).toBe(true);
    });

    it("should apply +5 for three-quarters cover on DEX saves", async () => {
      const diceRoller = new FixedDiceRoller(8);
      const resolver = new SavingThrowResolver(combatRepo, diceRoller);

      const action = makeAction({
        ability: "dexterity",
        dc: 15,
        context: { coverBonus: 5, coverLevel: "three-quarters" },
      });

      const resolution = await resolver.resolve(
        action,
        encounterId,
        [],
        [goblinMonster],
        [],
      );

      // DEX mod (+2) + cover bonus (+5) = +7
      expect(resolution.modifier).toBe(7);
      expect(resolution.coverBonus).toBe(5);
      // 8 + 7 = 15 vs DC 15 → success
      expect(resolution.total).toBe(15);
      expect(resolution.success).toBe(true);
    });
  });

  describe("non-DEX save should NOT get cover bonus", () => {
    it("should not apply cover bonus for WIS saves even with cover context", async () => {
      const diceRoller = new FixedDiceRoller(10);
      const resolver = new SavingThrowResolver(combatRepo, diceRoller);

      const action = makeAction({
        actorId: monsterId,
        ability: "wisdom",
        dc: 13,
        context: { coverBonus: 2, coverLevel: "half" },
      });

      const resolution = await resolver.resolve(
        action,
        encounterId,
        [],
        [goblinMonster],
        [],
      );

      // WIS mod for goblin is -1 (WIS 8), no proficiency, no cover bonus
      expect(resolution.modifier).toBe(-1);
      expect(resolution.coverBonus).toBeUndefined();
      // 10 + (-1) = 9 vs DC 13 → failure
      expect(resolution.total).toBe(9);
      expect(resolution.success).toBe(false);
    });

    it("should not apply cover bonus for CON saves", async () => {
      const diceRoller = new FixedDiceRoller(12);
      const resolver = new SavingThrowResolver(combatRepo, diceRoller);

      const action = makeAction({
        ability: "constitution",
        dc: 14,
        context: { coverBonus: 5, coverLevel: "three-quarters" },
      });

      const resolution = await resolver.resolve(
        action,
        encounterId,
        [],
        [goblinMonster],
        [],
      );

      // CON mod for goblin is 0 (CON 10), no cover bonus on CON save
      expect(resolution.modifier).toBe(0);
      expect(resolution.coverBonus).toBeUndefined();
    });
  });

  describe("buildResult message includes cover info", () => {
    it("should include cover bonus in message for DEX saves", () => {
      const diceRoller = new FixedDiceRoller(10);
      const resolver = new SavingThrowResolver(combatRepo, diceRoller);

      const action = makeAction({
        ability: "dexterity",
        dc: 15,
        context: { coverBonus: 2, coverLevel: "half" },
      });

      const resolution = {
        success: false,
        rawRoll: 10,
        modifier: 4, // 2 (DEX) + 2 (cover)
        total: 14,
        dc: 15,
        coverBonus: 2,
        appliedOutcome: { summary: "Full damage" },
        conditionsApplied: [],
        conditionsRemoved: [],
      };

      const result = resolver.buildResult(action, resolution);

      // Message should show base modifier (2) + cover bonus separately ("+ 2 (half)")
      expect(result.message).toContain("+ 2 (half)");
      expect(result.message).toContain("d20(10)");
      expect(result.message).toContain("DC 15");
    });

    it("should not include cover info in message when no cover bonus", () => {
      const diceRoller = new FixedDiceRoller(10);
      const resolver = new SavingThrowResolver(combatRepo, diceRoller);

      const action = makeAction({ ability: "dexterity", dc: 15 });

      const resolution = {
        success: false,
        rawRoll: 10,
        modifier: 2,
        total: 12,
        dc: 15,
        coverBonus: undefined,
        appliedOutcome: { summary: "Full damage" },
        conditionsApplied: [],
        conditionsRemoved: [],
      };

      const result = resolver.buildResult(action, resolution);

      expect(result.message).not.toContain("cover");
      expect(result.message).toContain("d20(10) + 2 =");
    });
  });

  describe("DEX save without cover context", () => {
    it("should not add cover bonus when context has no coverBonus", async () => {
      const diceRoller = new FixedDiceRoller(10);
      const resolver = new SavingThrowResolver(combatRepo, diceRoller);

      const action = makeAction({ ability: "dexterity", dc: 13 });

      const resolution = await resolver.resolve(
        action,
        encounterId,
        [],
        [goblinMonster],
        [],
      );

      // DEX mod only (+2), no cover
      expect(resolution.modifier).toBe(2);
      expect(resolution.coverBonus).toBeUndefined();
    });
  });
});
