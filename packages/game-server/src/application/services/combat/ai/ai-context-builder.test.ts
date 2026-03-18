/**
 * Unit tests for AiContextBuilder.
 *
 * Verifies that the combat context payload sent to the AI decision maker
 * correctly includes all enriched fields: resource pools, damage defenses,
 * concentration, active buffs, economy, AC, speed, initiative, death saves.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { AiContextBuilder } from "./ai-context-builder.js";
import {
  MemoryCharacterRepository,
  MemoryMonsterRepository,
  MemoryNPCRepository,
  MemoryCombatRepository,
} from "../../../../infrastructure/testing/memory-repos.js";
import { FactionService } from "../helpers/faction-service.js";
import type { ICombatantResolver } from "../helpers/combatant-resolver.js";
import type {
  CombatantStateRecord,
  CombatEncounterRecord,
  JsonValue,
} from "../../../types.js";
import type { AiCombatContext } from "./ai-types.js";

// ============================================================================
// Test helpers
// ============================================================================

const SESSION_ID = "test-session";

function makeEncounter(overrides?: Partial<CombatEncounterRecord>): CombatEncounterRecord {
  return {
    id: "enc-1",
    sessionId: SESSION_ID,
    status: "Active",
    round: 1,
    turn: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeCombatant(overrides: Partial<CombatantStateRecord> & { id: string }): CombatantStateRecord {
  return {
    encounterId: "enc-1",
    combatantType: "Monster",
    characterId: null,
    monsterId: null,
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

/**
 * Minimal stub for ICombatantResolver — only needs getNames() for context building.
 */
function stubCombatantResolver(nameOverrides?: Map<string, string>): ICombatantResolver {
  const names = nameOverrides ?? new Map<string, string>();
  return {
    async getName(_ref, state) {
      return names.get(state.id) ?? "Unknown";
    },
    async getNames(combatants) {
      const map = new Map<string, string>();
      for (const c of combatants) {
        map.set(c.id, names.get(c.id) ?? `Combatant-${c.id}`);
      }
      return map;
    },
    async getCombatStats() {
      throw new Error("Not needed for context builder tests");
    },
    async getMonsterAttacks() {
      return [];
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("AiContextBuilder", () => {
  let characters: MemoryCharacterRepository;
  let monsters: MemoryMonsterRepository;
  let npcs: MemoryNPCRepository;
  let combat: MemoryCombatRepository;
  let factionService: FactionService;
  let resolver: ICombatantResolver;
  let builder: AiContextBuilder;

  beforeEach(() => {
    characters = new MemoryCharacterRepository();
    monsters = new MemoryMonsterRepository();
    npcs = new MemoryNPCRepository();
    combat = new MemoryCombatRepository();
    factionService = new FactionService({ combat, characters, monsters, npcs });
    resolver = stubCombatantResolver(
      new Map([
        ["goblin-1", "Goblin"],
        ["char-1", "Thorin"],
        ["npc-1", "Guard Captain"],
        ["goblin-2", "Goblin Archer"],
      ]),
    );
    builder = new AiContextBuilder(characters, monsters, npcs, factionService, resolver);
  });

  // --------------------------------------------------------------------------
  // Monster combatant — basic fields
  // --------------------------------------------------------------------------

  describe("monster combatant basics", () => {
    it("includes name, type, alignment, CR, HP, AC, speed, initiative", async () => {
      const monster = await monsters.createInSession(SESSION_ID, {
        id: "goblin-1",
        name: "Goblin",
        monsterDefinitionId: null,
        statBlock: {
          type: "Humanoid",
          alignment: "Neutral Evil",
          cr: 0.25,
          armorClass: 15,
          speed: 30,
          attacks: [{ name: "Scimitar", toHit: 4, damage: "1d6+2", damageType: "slashing" }],
          traits: [],
          actions: [],
          bonusActions: [],
          reactions: [],
          spells: [],
        } as JsonValue,
      });

      const combatant = makeCombatant({
        id: "goblin-1",
        monsterId: "goblin-1",
        combatantType: "Monster",
        initiative: 14,
        hpCurrent: 5,
        hpMax: 7,
      });

      const encounter = makeEncounter();
      const entityData = { ...monster, statBlock: monster.statBlock } as unknown as Record<string, unknown>;

      const ctx = await builder.build(
        entityData, combatant, [combatant], encounter, [], [], [],
      );

      expect(ctx.combatant.name).toBe("Goblin");
      expect(ctx.combatant.type).toBe("Humanoid");
      expect(ctx.combatant.alignment).toBe("Neutral Evil");
      expect(ctx.combatant.cr).toBe(0.25);
      expect(ctx.combatant.ac).toBe(15);
      expect(ctx.combatant.speed).toBe(30);
      expect(ctx.combatant.initiative).toBe(14);
      expect(ctx.combatant.hp).toEqual({
        current: 5,
        max: 7,
        percentage: 71,
      });
      expect(ctx.combatant.attacks).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: "Scimitar" })]),
      );
    });

    it("defaults speed to 30 when stat block has no speed", async () => {
      await monsters.createInSession(SESSION_ID, {
        id: "goblin-1",
        name: "Goblin",
        monsterDefinitionId: null,
        statBlock: { armorClass: 12, attacks: [], traits: [], actions: [], bonusActions: [], reactions: [], spells: [] } as JsonValue,
      });

      const combatant = makeCombatant({ id: "goblin-1", monsterId: "goblin-1", combatantType: "Monster" });
      const monster = await monsters.getById("goblin-1");
      const ctx = await builder.build(
        monster as unknown as Record<string, unknown>, combatant, [combatant], makeEncounter(), [], [], [],
      );

      expect(ctx.combatant.speed).toBe(30);
    });
  });

  // --------------------------------------------------------------------------
  // Action economy
  // --------------------------------------------------------------------------

  describe("action economy", () => {
    it("correctly maps bonusActionUsed and reactionUsed fields", async () => {
      await monsters.createInSession(SESSION_ID, {
        id: "goblin-1",
        name: "Goblin",
        monsterDefinitionId: null,
        statBlock: { armorClass: 12, attacks: [], traits: [], actions: [], bonusActions: [], reactions: [], spells: [] } as JsonValue,
      });

      const combatant = makeCombatant({
        id: "goblin-1",
        monsterId: "goblin-1",
        combatantType: "Monster",
        resources: {
          actionSpent: true,
          bonusActionUsed: true,
          reactionUsed: true,
          movementSpent: false,
          movementRemaining: 15,
        } as JsonValue,
      });

      const monster = await monsters.getById("goblin-1");
      const ctx = await builder.build(
        monster as unknown as Record<string, unknown>, combatant, [combatant], makeEncounter(), [], [], [],
      );

      expect(ctx.combatant.economy).toBeDefined();
      expect(ctx.combatant.economy!.actionSpent).toBe(true);
      expect(ctx.combatant.economy!.bonusActionSpent).toBe(true);
      expect(ctx.combatant.economy!.reactionSpent).toBe(true);
      expect(ctx.combatant.economy!.movementSpent).toBe(false);
      expect(ctx.combatant.economy!.movementRemaining).toBe(15);
    });

    it("economy fields are false when resources are not spent", async () => {
      await monsters.createInSession(SESSION_ID, {
        id: "goblin-1",
        name: "Goblin",
        monsterDefinitionId: null,
        statBlock: { armorClass: 12, attacks: [], traits: [], actions: [], bonusActions: [], reactions: [], spells: [] } as JsonValue,
      });

      const combatant = makeCombatant({
        id: "goblin-1",
        monsterId: "goblin-1",
        combatantType: "Monster",
        resources: {
          actionSpent: false,
          bonusActionUsed: false,
          reactionUsed: false,
          movementSpent: false,
        } as JsonValue,
      });

      const monster = await monsters.getById("goblin-1");
      const ctx = await builder.build(
        monster as unknown as Record<string, unknown>, combatant, [combatant], makeEncounter(), [], [], [],
      );

      expect(ctx.combatant.economy!.actionSpent).toBe(false);
      expect(ctx.combatant.economy!.bonusActionSpent).toBe(false);
      expect(ctx.combatant.economy!.reactionSpent).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Resource pools
  // --------------------------------------------------------------------------

  describe("resource pools", () => {
    it("forwards ki points from combatant resources", async () => {
      await monsters.createInSession(SESSION_ID, {
        id: "goblin-1",
        name: "Goblin",
        monsterDefinitionId: null,
        statBlock: { armorClass: 12, attacks: [], traits: [], actions: [], bonusActions: [], reactions: [], spells: [] } as JsonValue,
      });

      const combatant = makeCombatant({
        id: "goblin-1",
        monsterId: "goblin-1",
        combatantType: "Monster",
        resources: {
          resourcePools: [
            { name: "ki", current: 3, max: 5 },
          ],
        } as JsonValue,
      });

      const monster = await monsters.getById("goblin-1");
      const ctx = await builder.build(
        monster as unknown as Record<string, unknown>, combatant, [combatant], makeEncounter(), [], [], [],
      );

      expect(ctx.combatant.resourcePools).toBeDefined();
      expect(ctx.combatant.resourcePools).toHaveLength(1);
      expect(ctx.combatant.resourcePools![0]).toEqual({ name: "ki", current: 3, max: 5 });
    });

    it("forwards multiple resource pools (ki + spell slots)", async () => {
      await monsters.createInSession(SESSION_ID, {
        id: "goblin-1",
        name: "Goblin",
        monsterDefinitionId: null,
        statBlock: { armorClass: 12, attacks: [], traits: [], actions: [], bonusActions: [], reactions: [], spells: [] } as JsonValue,
      });

      const combatant = makeCombatant({
        id: "goblin-1",
        monsterId: "goblin-1",
        combatantType: "Monster",
        resources: {
          resourcePools: [
            { name: "ki", current: 2, max: 5 },
            { name: "spellSlot_1", current: 3, max: 4 },
            { name: "spellSlot_2", current: 1, max: 3 },
          ],
        } as JsonValue,
      });

      const monster = await monsters.getById("goblin-1");
      const ctx = await builder.build(
        monster as unknown as Record<string, unknown>, combatant, [combatant], makeEncounter(), [], [], [],
      );

      expect(ctx.combatant.resourcePools).toHaveLength(3);
      expect(ctx.combatant.resourcePools!.map(p => p.name)).toEqual(["ki", "spellSlot_1", "spellSlot_2"]);
    });

    it("omits resourcePools when none present", async () => {
      await monsters.createInSession(SESSION_ID, {
        id: "goblin-1",
        name: "Goblin",
        monsterDefinitionId: null,
        statBlock: { armorClass: 12, attacks: [], traits: [], actions: [], bonusActions: [], reactions: [], spells: [] } as JsonValue,
      });

      const combatant = makeCombatant({
        id: "goblin-1",
        monsterId: "goblin-1",
        combatantType: "Monster",
        resources: {} as JsonValue,
      });

      const monster = await monsters.getById("goblin-1");
      const ctx = await builder.build(
        monster as unknown as Record<string, unknown>, combatant, [combatant], makeEncounter(), [], [], [],
      );

      expect(ctx.combatant.resourcePools).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Damage defenses
  // --------------------------------------------------------------------------

  describe("damage defenses", () => {
    it("extracts resistances, immunities, vulnerabilities from monster stat block", async () => {
      await monsters.createInSession(SESSION_ID, {
        id: "goblin-1",
        name: "Fire Elemental",
        monsterDefinitionId: null,
        statBlock: {
          armorClass: 13,
          damageResistances: ["bludgeoning", "piercing", "slashing"],
          damageImmunities: ["fire", "poison"],
          damageVulnerabilities: ["cold"],
          attacks: [],
          traits: [],
          actions: [],
          bonusActions: [],
          reactions: [],
          spells: [],
        } as JsonValue,
      });

      const combatant = makeCombatant({
        id: "goblin-1",
        monsterId: "goblin-1",
        combatantType: "Monster",
      });

      const monster = await monsters.getById("goblin-1");
      const ctx = await builder.build(
        monster as unknown as Record<string, unknown>, combatant, [combatant], makeEncounter(), [], [], [],
      );

      expect(ctx.combatant.damageResistances).toEqual(["bludgeoning", "piercing", "slashing"]);
      expect(ctx.combatant.damageImmunities).toEqual(["fire", "poison"]);
      expect(ctx.combatant.damageVulnerabilities).toEqual(["cold"]);
    });

    it("omits empty defense arrays", async () => {
      await monsters.createInSession(SESSION_ID, {
        id: "goblin-1",
        name: "Goblin",
        monsterDefinitionId: null,
        statBlock: {
          armorClass: 12,
          attacks: [],
          traits: [],
          actions: [],
          bonusActions: [],
          reactions: [],
          spells: [],
        } as JsonValue,
      });

      const combatant = makeCombatant({
        id: "goblin-1",
        monsterId: "goblin-1",
        combatantType: "Monster",
      });

      const monster = await monsters.getById("goblin-1");
      const ctx = await builder.build(
        monster as unknown as Record<string, unknown>, combatant, [combatant], makeEncounter(), [], [], [],
      );

      expect(ctx.combatant.damageResistances).toBeUndefined();
      expect(ctx.combatant.damageImmunities).toBeUndefined();
      expect(ctx.combatant.damageVulnerabilities).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Active buffs
  // --------------------------------------------------------------------------

  describe("active buffs", () => {
    it("maps raging/dashed/disengaged and ActiveEffect sources to human-readable names", async () => {
      await monsters.createInSession(SESSION_ID, {
        id: "goblin-1",
        name: "Berserker",
        monsterDefinitionId: null,
        statBlock: { armorClass: 14, attacks: [], traits: [], actions: [], bonusActions: [], reactions: [], spells: [] } as JsonValue,
      });

      const combatant = makeCombatant({
        id: "goblin-1",
        monsterId: "goblin-1",
        combatantType: "Monster",
        resources: {
          raging: true,
          dashed: true,
          disengaged: false,
          activeEffects: [
            { id: "e1", type: "advantage", target: "melee_attack_rolls", duration: "until_end_of_turn", source: "Reckless Attack" },
          ],
        } as JsonValue,
      });

      const monster = await monsters.getById("goblin-1");
      const ctx = await builder.build(
        monster as unknown as Record<string, unknown>, combatant, [combatant], makeEncounter(), [], [], [],
      );

      expect(ctx.combatant.activeBuffs).toBeDefined();
      expect(ctx.combatant.activeBuffs).toEqual(["Raging", "Dashed", "Reckless Attack"]);
    });

    it("omits activeBuffs when no buffs are active", async () => {
      await monsters.createInSession(SESSION_ID, {
        id: "goblin-1",
        name: "Goblin",
        monsterDefinitionId: null,
        statBlock: { armorClass: 12, attacks: [], traits: [], actions: [], bonusActions: [], reactions: [], spells: [] } as JsonValue,
      });

      const combatant = makeCombatant({
        id: "goblin-1",
        monsterId: "goblin-1",
        combatantType: "Monster",
        resources: {
          raging: false,
          dashed: false,
        } as JsonValue,
      });

      const monster = await monsters.getById("goblin-1");
      const ctx = await builder.build(
        monster as unknown as Record<string, unknown>, combatant, [combatant], makeEncounter(), [], [], [],
      );

      expect(ctx.combatant.activeBuffs).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Concentration
  // --------------------------------------------------------------------------

  describe("concentration", () => {
    it("forwards concentrationSpell on self", async () => {
      await monsters.createInSession(SESSION_ID, {
        id: "goblin-1",
        name: "Evil Wizard",
        monsterDefinitionId: null,
        statBlock: { armorClass: 12, attacks: [], traits: [], actions: [], bonusActions: [], reactions: [], spells: [] } as JsonValue,
      });

      const combatant = makeCombatant({
        id: "goblin-1",
        monsterId: "goblin-1",
        combatantType: "Monster",
        resources: {
          concentrationSpellName: "Hold Person",
        } as JsonValue,
      });

      const monster = await monsters.getById("goblin-1");
      const ctx = await builder.build(
        monster as unknown as Record<string, unknown>, combatant, [combatant], makeEncounter(), [], [], [],
      );

      expect(ctx.combatant.concentrationSpell).toBe("Hold Person");
    });

    it("omits concentrationSpell when not concentrating", async () => {
      await monsters.createInSession(SESSION_ID, {
        id: "goblin-1",
        name: "Goblin",
        monsterDefinitionId: null,
        statBlock: { armorClass: 12, attacks: [], traits: [], actions: [], bonusActions: [], reactions: [], spells: [] } as JsonValue,
      });

      const combatant = makeCombatant({
        id: "goblin-1",
        monsterId: "goblin-1",
        combatantType: "Monster",
        resources: {} as JsonValue,
      });

      const monster = await monsters.getById("goblin-1");
      const ctx = await builder.build(
        monster as unknown as Record<string, unknown>, combatant, [combatant], makeEncounter(), [], [], [],
      );

      expect(ctx.combatant.concentrationSpell).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Allies — concentration + death saves
  // --------------------------------------------------------------------------

  describe("ally details", () => {
    it("includes concentration and death saves for allies", async () => {
      // AI monster
      await monsters.createInSession(SESSION_ID, {
        id: "goblin-1",
        name: "Goblin",
        monsterDefinitionId: null,
        statBlock: { armorClass: 12, attacks: [{ name: "Bite", toHit: 3, damage: "1d4+1" }], traits: [], actions: [], bonusActions: [], reactions: [], spells: [] } as JsonValue,
      });
      // Allied monster (same faction)
      await monsters.createInSession(SESSION_ID, {
        id: "goblin-2",
        name: "Goblin Archer",
        monsterDefinitionId: null,
        statBlock: { armorClass: 13, attacks: [], traits: [], actions: [], bonusActions: [], reactions: [], spells: [] } as JsonValue,
      });

      const aiCombatant = makeCombatant({
        id: "goblin-1",
        monsterId: "goblin-1",
        combatantType: "Monster",
      });

      const allyCombatant = makeCombatant({
        id: "goblin-2",
        monsterId: "goblin-2",
        combatantType: "Monster",
        hpCurrent: 0,
        resources: {
          concentrationSpellName: "Bless",
          deathSaves: { successes: 1, failures: 2 },
        } as JsonValue,
      });

      // Both are monsters — same "enemy" faction → allies of each other
      const monster = await monsters.getById("goblin-1");
      const ctx = await builder.build(
        monster as unknown as Record<string, unknown>,
        aiCombatant,
        [aiCombatant, allyCombatant],
        makeEncounter(),
        [],
        [],
        [],
      );

      expect(ctx.allies).toHaveLength(1);
      const ally = ctx.allies[0]!;
      expect(ally.concentrationSpell).toBe("Bless");
      expect(ally.deathSaves).toEqual({ successes: 1, failures: 2 });
    });

    it("omits deathSaves when all zeros", async () => {
      await monsters.createInSession(SESSION_ID, {
        id: "goblin-1",
        name: "Goblin",
        monsterDefinitionId: null,
        statBlock: { armorClass: 12, attacks: [{ name: "Bite", toHit: 3, damage: "1d4+1" }], traits: [], actions: [], bonusActions: [], reactions: [], spells: [] } as JsonValue,
      });
      await monsters.createInSession(SESSION_ID, {
        id: "goblin-2",
        name: "Goblin Archer",
        monsterDefinitionId: null,
        statBlock: { armorClass: 13, attacks: [], traits: [], actions: [], bonusActions: [], reactions: [], spells: [] } as JsonValue,
      });

      const aiCombatant = makeCombatant({ id: "goblin-1", monsterId: "goblin-1", combatantType: "Monster" });
      const allyCombatant = makeCombatant({
        id: "goblin-2",
        monsterId: "goblin-2",
        combatantType: "Monster",
        resources: { deathSaves: { successes: 0, failures: 0 } } as JsonValue,
      });

      const monster = await monsters.getById("goblin-1");
      const ctx = await builder.build(
        monster as unknown as Record<string, unknown>,
        aiCombatant,
        [aiCombatant, allyCombatant],
        makeEncounter(),
        [],
        [],
        [],
      );

      expect(ctx.allies[0]!.deathSaves).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Enemies — defenses, concentration, death saves
  // --------------------------------------------------------------------------

  describe("enemy details", () => {
    it("includes damage defenses, concentration, and death saves for character enemies", async () => {
      // AI monster
      await monsters.createInSession(SESSION_ID, {
        id: "goblin-1",
        name: "Goblin",
        monsterDefinitionId: null,
        statBlock: { armorClass: 12, attacks: [{ name: "Scimitar", toHit: 4, damage: "1d6+2" }], traits: [], actions: [], bonusActions: [], reactions: [], spells: [] } as JsonValue,
      });

      // Enemy character
      await characters.createInSession(SESSION_ID, {
        id: "char-1",
        name: "Thorin",
        level: 5,
        className: "fighter",
        sheet: {
          armorClass: 18,
          speed: 30,
          damageResistances: ["fire"],
          damageImmunities: [],
          damageVulnerabilities: ["cold"],
        } as JsonValue,
      });

      const aiCombatant = makeCombatant({
        id: "goblin-1",
        monsterId: "goblin-1",
        combatantType: "Monster",
      });

      const enemyCombatant = makeCombatant({
        id: "char-1",
        characterId: "char-1",
        combatantType: "Character",
        hpCurrent: 10,
        hpMax: 44,
        resources: {
          concentrationSpellName: "Shield of Faith",
          deathSaves: { successes: 0, failures: 1 },
        } as JsonValue,
      });

      const monster = await monsters.getById("goblin-1");
      const ctx = await builder.build(
        monster as unknown as Record<string, unknown>,
        aiCombatant,
        [aiCombatant, enemyCombatant],
        makeEncounter(),
        [],
        [],
        [],
      );

      expect(ctx.enemies).toHaveLength(1);
      const enemy = ctx.enemies[0]!;
      expect(enemy.name).toBe("Thorin");
      expect(enemy.class).toBe("fighter");
      expect(enemy.level).toBe(5);
      expect(enemy.ac).toBe(18);
      expect(enemy.damageResistances).toEqual(["fire"]);
      expect(enemy.damageVulnerabilities).toEqual(["cold"]);
      expect(enemy.concentrationSpell).toBe("Shield of Faith");
      expect(enemy.deathSaves).toEqual({ successes: 0, failures: 1 });
    });

    it("includes damage defenses from monster enemies", async () => {
      // AI character
      await characters.createInSession(SESSION_ID, {
        id: "char-1",
        name: "Thorin",
        level: 5,
        className: "fighter",
        sheet: { armorClass: 16, speed: 30 } as JsonValue,
      });

      // Enemy monster with defenses
      await monsters.createInSession(SESSION_ID, {
        id: "goblin-1",
        name: "Fire Elemental",
        monsterDefinitionId: null,
        statBlock: {
          armorClass: 13,
          damageResistances: ["bludgeoning"],
          damageImmunities: ["fire", "poison"],
          damageVulnerabilities: ["cold"],
          attacks: [],
          traits: [],
          actions: [],
          bonusActions: [],
          reactions: [],
          spells: [],
        } as JsonValue,
      });

      const aiCombatant = makeCombatant({
        id: "char-1",
        characterId: "char-1",
        combatantType: "Character",
      });

      const enemyCombatant = makeCombatant({
        id: "goblin-1",
        monsterId: "goblin-1",
        combatantType: "Monster",
        hpCurrent: 100,
        hpMax: 102,
      });

      const character = await characters.getById("char-1");
      const ctx = await builder.build(
        character as unknown as Record<string, unknown>,
        aiCombatant,
        [aiCombatant, enemyCombatant],
        makeEncounter(),
        [],
        [],
        [],
      );

      expect(ctx.enemies).toHaveLength(1);
      const enemy = ctx.enemies[0]!;
      expect(enemy.damageResistances).toEqual(["bludgeoning"]);
      expect(enemy.damageImmunities).toEqual(["fire", "poison"]);
      expect(enemy.damageVulnerabilities).toEqual(["cold"]);
    });
  });

  // --------------------------------------------------------------------------
  // NPC combatant
  // --------------------------------------------------------------------------

  describe("NPC combatant", () => {
    it("includes AC, speed, defenses, resource pools for NPC", async () => {
      await npcs.createInSession(SESSION_ID, {
        id: "npc-1",
        name: "Guard Captain",
        statBlock: {
          className: "fighter",
          level: 3,
          armorClass: 16,
          speed: 25,
          damageResistances: ["poison"],
          spells: [],
          abilities: [],
          actions: [],
        } as JsonValue,
        faction: "party",
        aiControlled: true,
      });

      const combatant = makeCombatant({
        id: "npc-1",
        npcId: "npc-1",
        combatantType: "NPC",
        resources: {
          resourcePools: [{ name: "secondWind", current: 1, max: 1 }],
        } as JsonValue,
      });

      const npc = await npcs.getById("npc-1");
      const ctx = await builder.build(
        npc as unknown as Record<string, unknown>,
        combatant,
        [combatant],
        makeEncounter(),
        [],
        [],
        [],
      );

      expect(ctx.combatant.ac).toBe(16);
      expect(ctx.combatant.speed).toBe(25);
      expect(ctx.combatant.class).toBe("fighter");
      expect(ctx.combatant.level).toBe(3);
      expect(ctx.combatant.damageResistances).toEqual(["poison"]);
      expect(ctx.combatant.resourcePools).toEqual([{ name: "secondWind", current: 1, max: 1 }]);
    });
  });

  // --------------------------------------------------------------------------
  // Character combatant
  // --------------------------------------------------------------------------

  describe("character combatant", () => {
    it("includes AC, speed, defenses, resource pools, concentration for character", async () => {
      await characters.createInSession(SESSION_ID, {
        id: "char-1",
        name: "Thorin",
        level: 5,
        className: "monk",
        sheet: {
          armorClass: 17,
          speed: 40,
          damageResistances: [],
          damageImmunities: ["poison"],
          spells: [],
          abilities: [{ name: "Flurry of Blows" }],
        } as JsonValue,
      });

      const combatant = makeCombatant({
        id: "char-1",
        characterId: "char-1",
        combatantType: "Character",
        hpCurrent: 33,
        hpMax: 38,
        resources: {
          resourcePools: [{ name: "ki", current: 4, max: 5 }],
          concentrationSpellName: "Patient Defense",
          raging: false,
          dashed: true,
        } as JsonValue,
      });

      const character = await characters.getById("char-1");
      const ctx = await builder.build(
        character as unknown as Record<string, unknown>,
        combatant,
        [combatant],
        makeEncounter(),
        [],
        [],
        [],
      );

      expect(ctx.combatant.name).toBe("Thorin");
      expect(ctx.combatant.class).toBe("monk");
      expect(ctx.combatant.level).toBe(5);
      expect(ctx.combatant.ac).toBe(17);
      expect(ctx.combatant.speed).toBe(40);
      expect(ctx.combatant.damageImmunities).toEqual(["poison"]);
      expect(ctx.combatant.damageResistances).toBeUndefined(); // empty array omitted
      expect(ctx.combatant.resourcePools).toEqual([{ name: "ki", current: 4, max: 5 }]);
      expect(ctx.combatant.concentrationSpell).toBe("Patient Defense");
      expect(ctx.combatant.activeBuffs).toEqual(["Dashed"]);
    });
  });

  // --------------------------------------------------------------------------
  // Combat metadata
  // --------------------------------------------------------------------------

  describe("combat metadata", () => {
    it("includes round, turn, totalCombatants", async () => {
      await monsters.createInSession(SESSION_ID, {
        id: "goblin-1",
        name: "Goblin",
        monsterDefinitionId: null,
        statBlock: { armorClass: 12, attacks: [], traits: [], actions: [], bonusActions: [], reactions: [], spells: [] } as JsonValue,
      });

      const combatant = makeCombatant({ id: "goblin-1", monsterId: "goblin-1", combatantType: "Monster" });
      const combatant2 = makeCombatant({ id: "char-1", characterId: "char-1", combatantType: "Character" });

      const monster = await monsters.getById("goblin-1");
      const ctx = await builder.build(
        monster as unknown as Record<string, unknown>,
        combatant,
        [combatant, combatant2],
        makeEncounter({ round: 3, turn: 2 }),
        [],
        [],
        [],
      );

      expect(ctx.combat).toEqual({ round: 3, turn: 2, totalCombatants: 2 });
    });
  });

  // --------------------------------------------------------------------------
  // Narrative and history pass-through
  // --------------------------------------------------------------------------

  describe("narrative and history", () => {
    it("passes through recentNarrative, actionHistory, turnResults", async () => {
      await monsters.createInSession(SESSION_ID, {
        id: "goblin-1",
        name: "Goblin",
        monsterDefinitionId: null,
        statBlock: { armorClass: 12, attacks: [], traits: [], actions: [], bonusActions: [], reactions: [], spells: [] } as JsonValue,
      });

      const combatant = makeCombatant({ id: "goblin-1", monsterId: "goblin-1", combatantType: "Monster" });
      const monster = await monsters.getById("goblin-1");

      const narrative = ["Thorin swings his axe!", "The goblin dodges!"];
      const history = ["attack Thorin", "dodge"];
      const turnResults = [{
        step: 1,
        action: "attack" as const,
        ok: true,
        summary: "Hit!",
      }];

      const ctx = await builder.build(
        monster as unknown as Record<string, unknown>,
        combatant,
        [combatant],
        makeEncounter(),
        narrative,
        history,
        turnResults,
      );

      expect(ctx.recentNarrative).toEqual(narrative);
      expect(ctx.actionHistory).toEqual(history);
      expect(ctx.turnResults).toEqual(turnResults);
      expect(ctx.lastActionResult).toEqual(turnResults[0]);
    });

    it("lastActionResult is null when no turn results", async () => {
      await monsters.createInSession(SESSION_ID, {
        id: "goblin-1",
        name: "Goblin",
        monsterDefinitionId: null,
        statBlock: { armorClass: 12, attacks: [], traits: [], actions: [], bonusActions: [], reactions: [], spells: [] } as JsonValue,
      });

      const combatant = makeCombatant({ id: "goblin-1", monsterId: "goblin-1", combatantType: "Monster" });
      const monster = await monsters.getById("goblin-1");
      const ctx = await builder.build(
        monster as unknown as Record<string, unknown>, combatant, [combatant], makeEncounter(), [], [], [],
      );

      expect(ctx.lastActionResult).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Position
  // --------------------------------------------------------------------------

  describe("position", () => {
    it("extracts position from resources", async () => {
      await monsters.createInSession(SESSION_ID, {
        id: "goblin-1",
        name: "Goblin",
        monsterDefinitionId: null,
        statBlock: { armorClass: 12, attacks: [], traits: [], actions: [], bonusActions: [], reactions: [], spells: [] } as JsonValue,
      });

      const combatant = makeCombatant({
        id: "goblin-1",
        monsterId: "goblin-1",
        combatantType: "Monster",
        resources: {
          position: { x: 10, y: 20 },
        } as JsonValue,
      });

      const monster = await monsters.getById("goblin-1");
      const ctx = await builder.build(
        monster as unknown as Record<string, unknown>, combatant, [combatant], makeEncounter(), [], [], [],
      );

      expect(ctx.combatant.position).toEqual({ x: 10, y: 20 });
    });

    it("omits position when not set", async () => {
      await monsters.createInSession(SESSION_ID, {
        id: "goblin-1",
        name: "Goblin",
        monsterDefinitionId: null,
        statBlock: { armorClass: 12, attacks: [], traits: [], actions: [], bonusActions: [], reactions: [], spells: [] } as JsonValue,
      });

      const combatant = makeCombatant({
        id: "goblin-1",
        monsterId: "goblin-1",
        combatantType: "Monster",
        resources: {} as JsonValue,
      });

      const monster = await monsters.getById("goblin-1");
      const ctx = await builder.build(
        monster as unknown as Record<string, unknown>, combatant, [combatant], makeEncounter(), [], [], [],
      );

      expect(ctx.combatant.position).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Conditions
  // --------------------------------------------------------------------------

  describe("conditions", () => {
    it("includes conditions when present", async () => {
      await monsters.createInSession(SESSION_ID, {
        id: "goblin-1",
        name: "Goblin",
        monsterDefinitionId: null,
        statBlock: { armorClass: 12, attacks: [], traits: [], actions: [], bonusActions: [], reactions: [], spells: [] } as JsonValue,
      });

      const combatant = makeCombatant({
        id: "goblin-1",
        monsterId: "goblin-1",
        combatantType: "Monster",
        conditions: [{ condition: "stunned", source: "player", duration: "until_removed" }] as JsonValue,
      });

      const monster = await monsters.getById("goblin-1");
      const ctx = await builder.build(
        monster as unknown as Record<string, unknown>, combatant, [combatant], makeEncounter(), [], [], [],
      );

      expect(ctx.combatant.conditions).toContain("stunned");
    });

    it("omits conditions when empty", async () => {
      await monsters.createInSession(SESSION_ID, {
        id: "goblin-1",
        name: "Goblin",
        monsterDefinitionId: null,
        statBlock: { armorClass: 12, attacks: [], traits: [], actions: [], bonusActions: [], reactions: [], spells: [] } as JsonValue,
      });

      const combatant = makeCombatant({
        id: "goblin-1",
        monsterId: "goblin-1",
        combatantType: "Monster",
        conditions: [] as JsonValue,
      });

      const monster = await monsters.getById("goblin-1");
      const ctx = await builder.build(
        monster as unknown as Record<string, unknown>, combatant, [combatant], makeEncounter(), [], [], [],
      );

      expect(ctx.combatant.conditions).toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Full integration: all enriched fields together
  // --------------------------------------------------------------------------

  describe("full enriched context integration", () => {
    it("builds complete context with all enriched fields for a monster vs character scenario", async () => {
      // Monster (AI-controlled)
      await monsters.createInSession(SESSION_ID, {
        id: "goblin-1",
        name: "Goblin Shaman",
        monsterDefinitionId: null,
        statBlock: {
          type: "Humanoid",
          alignment: "Chaotic Evil",
          cr: 2,
          armorClass: 13,
          speed: 30,
          damageResistances: ["necrotic"],
          attacks: [{ name: "Staff", toHit: 3, damage: "1d6+1" }],
          spells: [{ name: "Hex", level: 1 }],
          traits: [{ name: "Spellcasting" }],
          actions: [],
          bonusActions: [],
          reactions: [],
        } as JsonValue,
      });

      // Character (enemy of monster)
      await characters.createInSession(SESSION_ID, {
        id: "char-1",
        name: "Thorin",
        level: 5,
        className: "fighter",
        sheet: {
          armorClass: 18,
          speed: 30,
          damageResistances: ["fire"],
          damageImmunities: [],
          damageVulnerabilities: [],
        } as JsonValue,
      });

      const aiCombatant = makeCombatant({
        id: "goblin-1",
        monsterId: "goblin-1",
        combatantType: "Monster",
        initiative: 16,
        hpCurrent: 15,
        hpMax: 27,
        resources: {
          position: { x: 15, y: 10 },
          actionSpent: false,
          bonusActionUsed: false,
          reactionUsed: false,
          movementSpent: false,
          movementRemaining: 30,
          resourcePools: [
            { name: "spellSlot_1", current: 2, max: 3 },
          ],
          concentrationSpellName: "Hex",
          raging: false,
          dashed: false,
          disengaged: false,
          recklessAttack: false,
        } as JsonValue,
        conditions: [{ condition: "poisoned", source: "trap", duration: "until_removed" }] as JsonValue,
      });

      const enemyCombatant = makeCombatant({
        id: "char-1",
        characterId: "char-1",
        combatantType: "Character",
        initiative: 12,
        hpCurrent: 30,
        hpMax: 44,
        resources: {
          position: { x: 20, y: 10 },
          concentrationSpellName: "Shield of Faith",
        } as JsonValue,
      });

      const monster = await monsters.getById("goblin-1");
      const ctx = await builder.build(
        monster as unknown as Record<string, unknown>,
        aiCombatant,
        [aiCombatant, enemyCombatant],
        makeEncounter({ round: 2, turn: 3 }),
        ["The battle rages on!"],
        ["attack Thorin"],
        [],
      );

      // -- Self context --
      expect(ctx.combatant.name).toBe("Goblin Shaman");
      expect(ctx.combatant.ac).toBe(13);
      expect(ctx.combatant.speed).toBe(30);
      expect(ctx.combatant.initiative).toBe(16);
      expect(ctx.combatant.position).toEqual({ x: 15, y: 10 });
      expect(ctx.combatant.conditions).toEqual(["poisoned"]);
      expect(ctx.combatant.concentrationSpell).toBe("Hex");
      expect(ctx.combatant.damageResistances).toEqual(["necrotic"]);
      expect(ctx.combatant.resourcePools).toEqual([{ name: "spellSlot_1", current: 2, max: 3 }]);
      expect(ctx.combatant.activeBuffs).toBeUndefined(); // all false
      expect(ctx.combatant.economy).toEqual({
        actionSpent: false,
        bonusActionSpent: false,
        reactionSpent: false,
        movementSpent: false,
        movementRemaining: 30,
      });

      // -- Enemy context --
      expect(ctx.enemies).toHaveLength(1);
      const enemy = ctx.enemies[0]!;
      expect(enemy.ac).toBe(18);
      expect(enemy.damageResistances).toEqual(["fire"]);
      expect(enemy.concentrationSpell).toBe("Shield of Faith");

      // -- Combat metadata --
      expect(ctx.combat).toEqual({ round: 2, turn: 3, totalCombatants: 2 });

      // -- Narrative --
      expect(ctx.recentNarrative).toEqual(["The battle rages on!"]);
      expect(ctx.actionHistory).toEqual(["attack Thorin"]);
    });
  });

  // --------------------------------------------------------------------------
  // Type safety: verify AiCombatContext shape
  // --------------------------------------------------------------------------

  describe("type conformance", () => {
    it("returned context satisfies AiCombatContext interface", async () => {
      await monsters.createInSession(SESSION_ID, {
        id: "goblin-1",
        name: "Goblin",
        monsterDefinitionId: null,
        statBlock: { armorClass: 12, attacks: [], traits: [], actions: [], bonusActions: [], reactions: [], spells: [] } as JsonValue,
      });

      const combatant = makeCombatant({ id: "goblin-1", monsterId: "goblin-1", combatantType: "Monster" });
      const monster = await monsters.getById("goblin-1");
      const ctx: AiCombatContext = await builder.build(
        monster as unknown as Record<string, unknown>, combatant, [combatant], makeEncounter(), [], [], [],
      );

      // Required top-level fields exist
      expect(ctx).toHaveProperty("combatant");
      expect(ctx).toHaveProperty("combat");
      expect(ctx).toHaveProperty("allies");
      expect(ctx).toHaveProperty("enemies");
      expect(ctx).toHaveProperty("recentNarrative");
      expect(ctx).toHaveProperty("actionHistory");
      expect(ctx).toHaveProperty("turnResults");
      expect(ctx).toHaveProperty("lastActionResult");

      // Combatant required fields
      expect(ctx.combatant).toHaveProperty("name");
      expect(ctx.combatant).toHaveProperty("hp");
      expect(ctx.combatant.hp).toHaveProperty("current");
      expect(ctx.combatant.hp).toHaveProperty("max");
      expect(ctx.combatant.hp).toHaveProperty("percentage");
    });
  });
});
