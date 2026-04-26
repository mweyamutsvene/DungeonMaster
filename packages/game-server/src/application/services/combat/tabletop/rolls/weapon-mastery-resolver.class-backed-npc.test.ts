/**
 * Tests for WeaponMasteryResolver DC computation for class-backed NPCs.
 *
 * Verifies that push/topple mastery DCs are derived from the class-backed
 * NPC's sheet (via getClassBackedActorSource) rather than defaulting to
 * empty/fallback values when a stat-block NPC or Character is used.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { WeaponMasteryResolver } from "./weapon-mastery-resolver.js";
import { SavingThrowResolver } from "./saving-throw-resolver.js";
import { MemoryCombatRepository } from "../../../../../infrastructure/testing/memory-repos.js";
import { FixedDiceRoller } from "../../../../../domain/rules/dice-roller.js";
import type { TabletopCombatServiceDeps } from "../tabletop-types.js";

const SESSION_ID = "sess-mastery";
const ENCOUNTER_ID = "enc-mastery";
const ATTACKER_ID = "npc-fighter-1";
const TARGET_ID = "goblin-1";

function makeClassBackedNpc(overrides: Partial<any> = {}) {
  return {
    id: ATTACKER_ID,
    name: "Allied Fighter",
    statBlock: null,
    className: "Fighter",
    level: 5,
    sheet: {
      classId: "fighter",
      level: 5,
      maxHP: 44,
      currentHP: 44,
      speed: 30,
      abilityScores: {
        // STR 16 → mod +3
        strength: 16,
        dexterity: 13,
        constitution: 15,
        intelligence: 10,
        wisdom: 11,
        charisma: 10,
      },
    },
    ...overrides,
  };
}

function makeGoblinMonster() {
  return {
    id: TARGET_ID,
    name: "Goblin",
    statBlock: {
      abilityScores: {
        strength: 8,
        dexterity: 14,
        constitution: 10,
        intelligence: 10,
        wisdom: 8,
        charisma: 8,
      },
      saveProficiencies: [] as string[],
    },
  };
}

async function setup(fixedRoll: number) {
  const combatRepo = new MemoryCombatRepository();
  await combatRepo.createEncounter(SESSION_ID, {
    id: ENCOUNTER_ID,
    status: "Active",
    round: 1,
    turn: 0,
  });
  await combatRepo.createCombatants(ENCOUNTER_ID, [
    {
      id: "cbt-attacker",
      combatantType: "NPC",
      characterId: null,
      monsterId: null,
      npcId: ATTACKER_ID,
      initiative: 15,
      hpCurrent: 44,
      hpMax: 44,
      conditions: [],
      resources: {},
    },
    {
      id: "cbt-goblin",
      combatantType: "Monster",
      characterId: null,
      monsterId: TARGET_ID,
      npcId: null,
      initiative: 8,
      hpCurrent: 7,
      hpMax: 7,
      conditions: [],
      resources: { position: { x: 1, y: 0 } },
    },
  ]);

  const diceRoller = new FixedDiceRoller(fixedRoll);
  const savingThrowResolver = new SavingThrowResolver(combatRepo, diceRoller);

  const deps = {
    combatRepo,
  } as unknown as TabletopCombatServiceDeps;

  const resolver = new WeaponMasteryResolver(deps, savingThrowResolver, false);
  return { resolver, combatRepo };
}

describe("WeaponMasteryResolver — class-backed NPC DC computation", () => {
  const weaponSpec = {
    name: "Longsword",
    properties: [] as string[],
    damage: "1d8",
    damageType: "slashing",
    range: 5,
  };

  describe("Push mastery DC derived from class-backed NPC sheet", () => {
    it("uses NPC STR modifier and proficiency bonus for push DC", async () => {
      // Level-5 Fighter: profBonus = 3, STR 16 = +3 → DC = 8 + 3 + 3 = 14
      // Roll 12 for goblin: STR -1 + 12 = 11 → fails DC 14
      const { resolver } = await setup(12);
      const npc = makeClassBackedNpc();
      const goblin = makeGoblinMonster();

      const result = await resolver.resolve(
        "push",
        ATTACKER_ID,
        TARGET_ID,
        ENCOUNTER_ID,
        SESSION_ID,
        weaponSpec as any,
        [],         // characters
        [goblin],   // monsters
        [npc],      // npcs
      );

      // DC 14 with goblin STR -1 + roll 12 = 11 → pushed
      expect(result).toContain("pushed 10 feet");
      // Message must reference DC 14
      expect(result).toContain("DC 14");
    });

    it("goblin succeeds push save when roll is high enough", async () => {
      // Roll 17: goblin STR -1 + 17 = 16 → beats DC 14
      const { resolver } = await setup(17);
      const npc = makeClassBackedNpc();
      const goblin = makeGoblinMonster();

      const result = await resolver.resolve(
        "push",
        ATTACKER_ID,
        TARGET_ID,
        ENCOUNTER_ID,
        SESSION_ID,
        weaponSpec as any,
        [],
        [goblin],
        [npc],
      );

      expect(result).toContain("resists");
      expect(result).toContain("DC 14");
    });
  });

  describe("Topple mastery DC derived from class-backed NPC sheet", () => {
    it("uses NPC proficiency bonus for topple DC", async () => {
      // Same formula: DC = 8 + STR mod (3) + profBonus (3) = 14
      // Goblin CON 10 → +0, roll 10 → total 10 → fails DC 14
      const { resolver } = await setup(10);
      const npc = makeClassBackedNpc();
      const goblin = makeGoblinMonster();

      const result = await resolver.resolve(
        "topple",
        ATTACKER_ID,
        TARGET_ID,
        ENCOUNTER_ID,
        SESSION_ID,
        weaponSpec as any,
        [],
        [goblin],
        [npc],
      );

      expect(result).toContain("Prone");
      expect(result).toContain("DC 14");
    });
  });

  describe("DC falls back to minimum when actor not found", () => {
    it("uses minimal DC (8) when actor has no sheet data", async () => {
      // Roll 1: even with minimal DC, 1 + 0 = 1 → should fail
      const { resolver } = await setup(1);
      const goblin = makeGoblinMonster();

      const result = await resolver.resolve(
        "push",
        "unknown-actor",   // not in any list
        TARGET_ID,
        ENCOUNTER_ID,
        SESSION_ID,
        weaponSpec as any,
        [],
        [goblin],
        [],
      );

      // DC = 8 + 0 (no actor) + 2 (default profBonus) = 10; roll 1, goblin STR -1 = 0 → fails
      expect(result).toContain("pushed");
    });
  });
});
