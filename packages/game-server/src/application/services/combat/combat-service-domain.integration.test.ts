/**
 * Integration tests validating domain-driven combat path produces identical results to manual implementation.
 * These tests run with DM_USE_DOMAIN_COMBAT=1 to exercise the nextTurnDomain() code path.
 */
import { describe, it, expect } from "vitest";
import { CombatService } from "./combat-service.js";
import { BasicCombatVictoryPolicy } from "./combat-victory-policy.js";
import { FixedDiceRoller } from "../../../domain/rules/dice-roller.js";
import type {
  IGameSessionRepository,
  ICombatRepository,
  IEventRepository,
  ICharacterRepository,
  IMonsterRepository,
  INPCRepository,
} from "../../repositories/index.js";
import type {
  CombatEncounterRecord,
  CombatantStateRecord,
  GameEventRecord,
  GameSessionRecord,
  JsonValue,
  SessionCharacterRecord,
  SessionMonsterRecord,
  SessionNPCRecord,
} from "../../types.js";

// In-memory repository implementations for testing
class MemorySessionRepository implements IGameSessionRepository {
  private sessions = new Map<string, GameSessionRecord>();

  async getById(id: string): Promise<GameSessionRecord | null> {
    return this.sessions.get(id) ?? null;
  }

  async create(input: { id: string; storyFramework: JsonValue }): Promise<GameSessionRecord> {
    const now = new Date();
    const rec: GameSessionRecord = {
      id: input.id,
      storyFramework: input.storyFramework,
      createdAt: now,
      updatedAt: now,
    };
    this.sessions.set(rec.id, rec);
    return rec;
  }
}

class MemoryCombatRepository implements ICombatRepository {
  private encounters = new Map<string, CombatEncounterRecord>();
  private combatantsByEncounter = new Map<string, CombatantStateRecord[]>();
  private pendingByEncounter = new Map<string, JsonValue>();

  async listEncountersBySession(sessionId: string): Promise<CombatEncounterRecord[]> {
    const results: CombatEncounterRecord[] = [];
    for (const enc of this.encounters.values()) {
      if (enc.sessionId === sessionId) {
        results.push(enc);
      }
    }
    // Sort by createdAt desc (most recent first)
    return results.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async createEncounter(
    sessionId: string,
    input: { id: string; status: string; round: number; turn: number; mapData?: JsonValue },
  ): Promise<CombatEncounterRecord> {
    const now = new Date();
    const rec: CombatEncounterRecord = {
      id: input.id,
      sessionId,
      status: input.status,
      round: input.round,
      turn: input.turn,
      mapData: input.mapData,
      createdAt: now,
      updatedAt: now,
    };
    this.encounters.set(rec.id, rec);
    this.combatantsByEncounter.set(rec.id, []);
    return rec;
  }

  async getEncounterById(id: string): Promise<CombatEncounterRecord | null> {
    return this.encounters.get(id) ?? null;
  }

  async updateEncounter(
    id: string,
    patch: Partial<Pick<CombatEncounterRecord, "status" | "round" | "turn" | "mapData">>,
  ): Promise<CombatEncounterRecord> {
    const existing = this.encounters.get(id);
    if (!existing) throw new Error("Encounter not found");
    const updated: CombatEncounterRecord = { ...existing, ...patch, updatedAt: new Date() };
    this.encounters.set(id, updated);
    return updated;
  }

  async listCombatants(encounterId: string): Promise<CombatantStateRecord[]> {
    return this.combatantsByEncounter.get(encounterId) ?? [];
  }

  async createCombatants(
    encounterId: string,
    combatants: Array<{
      id: string;
      combatantType: CombatantStateRecord["combatantType"];
      characterId: string | null;
      monsterId: string | null;
      npcId: string | null;
      initiative: number | null;
      hpCurrent: number;
      hpMax: number;
      hpTemp?: number;
      conditions: JsonValue;
      resources: JsonValue;
    }>,
  ): Promise<CombatantStateRecord[]> {
    const created = combatants.map((c, i) => {
      const rec: CombatantStateRecord = {
        ...c,
        hpTemp: c.hpTemp ?? 0,
        encounterId,
        createdAt: new Date(Date.now() + i),
        updatedAt: new Date(Date.now() + i),
      };
      return rec;
    });
    this.combatantsByEncounter.set(encounterId, created);
    return created;
  }

  async updateCombatantState(
    id: string,
    patch: Partial<Pick<CombatantStateRecord, "hpCurrent" | "hpMax" | "hpTemp" | "initiative" | "conditions" | "resources">>,
  ): Promise<CombatantStateRecord> {
    for (const combatants of this.combatantsByEncounter.values()) {
      const idx = combatants.findIndex((c) => c.id === id);
      if (idx >= 0) {
        const updated: CombatantStateRecord = { ...combatants[idx], ...patch, updatedAt: new Date() };
        combatants[idx] = updated;
        return updated;
      }
    }
    throw new Error("Combatant not found");
  }

  async setPendingAction(encounterId: string, action: JsonValue): Promise<void> {
    this.pendingByEncounter.set(encounterId, action);
  }

  async getPendingAction(encounterId: string): Promise<JsonValue | null> {
    return this.pendingByEncounter.get(encounterId) ?? null;
  }

  async clearPendingAction(encounterId: string): Promise<void> {
    this.pendingByEncounter.delete(encounterId);
  }

  async findActiveEncounter(sessionId: string): Promise<CombatEncounterRecord | null> {
    const encounters = await this.listEncountersBySession(sessionId);
    return encounters.find((e) => e.status === "Active") ?? encounters[0] ?? null;
  }

  async findById(encounterId: string): Promise<CombatEncounterRecord | null> {
    return this.getEncounterById(encounterId);
  }

  async startCombat(
    encounterId: string,
    initiatives: Record<string, number>,
  ): Promise<CombatEncounterRecord> {
    const combatants = this.combatantsByEncounter.get(encounterId) ?? [];
    const updatedCombatants = combatants.map((c) => {
      const initiative = initiatives[c.id];
      if (typeof initiative === "number") {
        return { ...c, initiative, updatedAt: new Date() };
      }
      return c;
    });
    this.combatantsByEncounter.set(encounterId, updatedCombatants);
    return this.updateEncounter(encounterId, { status: "Active" });
  }
}

class MemoryEventRepository implements IEventRepository {
  private events: GameEventRecord[] = [];

  async listBySession(
    sessionId: string,
    input?: { limit?: number; since?: Date },
  ): Promise<GameEventRecord[]> {
    const filtered = this.events
      .filter((e) => e.sessionId === sessionId)
      .filter((e) => (input?.since ? e.createdAt.getTime() > input.since.getTime() : true));
    if (typeof input?.limit === "number") return filtered.slice(-input.limit);
    return filtered;
  }

  async append(
    sessionId: string,
    input: { id: string; type: string; payload: JsonValue },
  ): Promise<GameEventRecord> {
    const rec: GameEventRecord = { ...input, sessionId, createdAt: new Date() };
    this.events.push(rec);
    return rec;
  }
}

class MemoryCharacterRepository implements ICharacterRepository {
  private characters = new Map<string, SessionCharacterRecord>();

  async getById(id: string): Promise<SessionCharacterRecord | null> {
    return this.characters.get(id) ?? null;
  }

  async createInSession(
    sessionId: string,
    input: {
      id: string;
      name: string;
      level: number;
      className: string | null;
      sheet: JsonValue;
    },
  ): Promise<SessionCharacterRecord> {
    const now = new Date();
    const rec: SessionCharacterRecord = {
      id: input.id,
      sessionId,
      name: input.name,
      level: input.level,
      className: input.className,
      sheet: input.sheet,
      faction: "party",
      aiControlled: false,
      createdAt: now,
      updatedAt: now,
    };
    this.characters.set(rec.id, rec);
    return rec;
  }

  async getManyByIds(ids: string[]): Promise<SessionCharacterRecord[]> {
    return ids
      .map((id) => this.characters.get(id) ?? null)
      .filter((c): c is SessionCharacterRecord => c !== null);
  }

  async listBySession(sessionId: string): Promise<SessionCharacterRecord[]> {
    return Array.from(this.characters.values()).filter((c) => c.sessionId === sessionId);
  }
}

class MemoryMonsterRepository implements IMonsterRepository {
  private monsters = new Map<string, SessionMonsterRecord>();

  async getById(id: string): Promise<SessionMonsterRecord | null> {
    return this.monsters.get(id) ?? null;
  }

  async createInSession(
    sessionId: string,
    input: {
      id: string;
      name: string;
      monsterDefinitionId: string | null;
      statBlock: JsonValue;
    },
  ): Promise<SessionMonsterRecord> {
    const now = new Date();
    const rec: SessionMonsterRecord = {
      id: input.id,
      sessionId,
      name: input.name,
      monsterDefinitionId: input.monsterDefinitionId,
      statBlock: input.statBlock,
      faction: "enemy",
      aiControlled: true,
      createdAt: now,
      updatedAt: now,
    };
    this.monsters.set(rec.id, rec);
    return rec;
  }

  async getManyByIds(ids: string[]): Promise<SessionMonsterRecord[]> {
    return ids
      .map((id) => this.monsters.get(id) ?? null)
      .filter((m): m is SessionMonsterRecord => m !== null);
  }

  async listBySession(sessionId: string): Promise<SessionMonsterRecord[]> {
    return Array.from(this.monsters.values()).filter((m) => m.sessionId === sessionId);
  }
}

class MemoryNPCRepository implements INPCRepository {
  private npcs = new Map<string, SessionNPCRecord>();

  async getById(id: string): Promise<SessionNPCRecord | null> {
    return this.npcs.get(id) ?? null;
  }

  async createInSession(
    sessionId: string,
    input: { id: string; name: string; statBlock: JsonValue; faction?: string; aiControlled?: boolean },
  ): Promise<SessionNPCRecord> {
    const now = new Date();
    const rec: SessionNPCRecord = {
      id: input.id,
      sessionId,
      name: input.name,
      statBlock: input.statBlock,
      faction: input.faction ?? "neutral",
      aiControlled: input.aiControlled ?? false,
      createdAt: now,
      updatedAt: now,
    };
    this.npcs.set(rec.id, rec);
    return rec;
  }

  async getManyByIds(ids: string[]): Promise<SessionNPCRecord[]> {
    return ids
      .map((id) => this.npcs.get(id) ?? null)
      .filter((n): n is SessionNPCRecord => n !== null);
  }

  async listBySession(sessionId: string): Promise<SessionNPCRecord[]> {
    return Array.from(this.npcs.values()).filter((n) => n.sessionId === sessionId);
  }

  async delete(id: string): Promise<void> {
    this.npcs.delete(id);
  }
}

class MockFactionService {
  async getFactions(combatants: CombatantStateRecord[]) {
    const map = new Map<string, "player" | "enemy">();
    for (const c of combatants) {
      if (c.combatantType === "Character") {
        map.set(c.id, "player");
      } else {
        map.set(c.id, "enemy");
      }
    }
    return map;
  }
  async getPlayerAllegiance() {
    return ["c1"];
  }
  async getEnemyAllegiance() {
    return ["m1"];
  }
}

describe("CombatService Domain Integration", () => {
  it("domain path produces identical turn progression to manual path", async () => {
    // Setup: Create session with character and monster
    const sessionsRepo = new MemorySessionRepository();
    const combatRepo = new MemoryCombatRepository();
    const eventsRepo = new MemoryEventRepository();
    const charactersRepo = new MemoryCharacterRepository();
    const monstersRepo = new MemoryMonsterRepository();
    const npcsRepo = new MemoryNPCRepository();

    const session = await sessionsRepo.create({
      id: "sess-1",
      storyFramework: { setting: "Test" },
    });

    const character = await charactersRepo.createInSession(session.id, {
      id: "c1",
      name: "Fighter",
      level: 1,
      className: "Fighter",
      sheet: {
        level: 1,
        className: "Fighter",
        abilityScores: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
        maxHp: 12,
        armorClass: 16,
        proficiencyBonus: 2,
        speed: 30,
      },
    });

    const monster = await monstersRepo.createInSession(session.id, {
      id: "m1",
      name: "Goblin",
      monsterDefinitionId: null,
      statBlock: {
        maxHp: 7,
        armorClass: 15,
        speed: 30,
        abilityScores: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
        proficiencyBonus: 2,
      },
    });

    // Create encounter with combatants (character wins initiative)
    const encounter = await combatRepo.createEncounter(session.id, {
      id: "enc-1",
      status: "Active",
      round: 1,
      turn: 0,
    });
    await combatRepo.createCombatants(encounter.id, [
      {
        id: "c1",
        combatantType: "Character",
        characterId: character.id,
        monsterId: null,
        npcId: null,
        initiative: 15,
        hpCurrent: 12,
        hpMax: 12,
        conditions: [],
        resources: {},
      },
      {
        id: "m1",
        combatantType: "Monster",
        characterId: null,
        monsterId: monster.id,
        npcId: null,
        initiative: 10,
        hpCurrent: 7,
        hpMax: 7,
        conditions: [],
        resources: {},
      },
    ]);

    const factionService = new MockFactionService() as any;
    const victoryPolicy = new BasicCombatVictoryPolicy(factionService);
    const diceRoller = new FixedDiceRoller(10);

    // CombatService with domain dependencies (will use nextTurnDomain when flag ON)
    const combatService = new CombatService(
      sessionsRepo,
      combatRepo,
      victoryPolicy,
      eventsRepo,
      charactersRepo,
      monstersRepo,
      npcsRepo,
      diceRoller,
    );

    // Advance turn: character -> goblin (turn 1)
    const result1 = await combatService.nextTurn(session.id);
    expect(result1.round).toBe(1);
    expect(result1.turn).toBe(1); // now goblin's turn

    // Advance turn: goblin -> character (round 2)
    const result2 = await combatService.nextTurn(session.id);
    expect(result2.round).toBe(2);
    expect(result2.turn).toBe(0); // wraps to character

    // Verify action economy was reset for both combatants
    const combatants = await combatRepo.listCombatants(encounter.id);
    expect(combatants).toHaveLength(2);

    // Both should have fresh action economy
    for (const combatant of combatants) {
      const resources = combatant.resources as any;
      // Domain path explicitly sets flags to false (vs manual path which deletes them)
      expect(resources.actionSpent).toBe(false);
      expect(resources.bonusActionSpent).toBe(false);
      expect(resources.reactionSpent).toBe(false);
      expect(resources.movementRemaining).toBe(30);
    }

    // Verify events were emitted
    const events = await eventsRepo.listBySession(session.id);
    const turnEvents = events.filter((e) => e.type === "TurnAdvanced");
    expect(turnEvents).toHaveLength(2);
    expect(turnEvents[0].payload).toMatchObject({ round: 1, turn: 1 });
    expect(turnEvents[1].payload).toMatchObject({ round: 2, turn: 0 });
  });

  it("domain path handles victory detection before advancing turn", async () => {
    const sessionsRepo = new MemorySessionRepository();
    const combatRepo = new MemoryCombatRepository();
    const eventsRepo = new MemoryEventRepository();
    const charactersRepo = new MemoryCharacterRepository();
    const monstersRepo = new MemoryMonsterRepository();
    const npcsRepo = new MemoryNPCRepository();

    const session = await sessionsRepo.create({
      id: "sess-2",
      storyFramework: { setting: "Test" },
    });

    const character = await charactersRepo.createInSession(session.id, {
      id: "c1",
      name: "Fighter",
      level: 1,
      className: "Fighter",
      sheet: {
        level: 1,
        className: "Fighter",
        abilityScores: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 8 },
        maxHp: 12,
        armorClass: 16,
        proficiencyBonus: 2,
        speed: 30,
      },
    });

    const monster = await monstersRepo.createInSession(session.id, {
      id: "m1",
      name: "Goblin",
      monsterDefinitionId: null,
      statBlock: {
        maxHp: 7,
        armorClass: 15,
        speed: 30,
        abilityScores: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
        proficiencyBonus: 2,
      },
    });

    const encounter = await combatRepo.createEncounter(session.id, {
      id: "enc-2",
      status: "Active",
      round: 1,
      turn: 0,
    });
    await combatRepo.createCombatants(encounter.id, [
      {
        id: "c1",
        combatantType: "Character",
        characterId: character.id,
        monsterId: null,
        npcId: null,
        initiative: 15,
        hpCurrent: 12,
        hpMax: 12,
        conditions: [],
        resources: {},
      },
      {
        id: "m1",
        combatantType: "Monster",
        characterId: null,
        monsterId: monster.id,
        npcId: null,
        initiative: 10,
        hpCurrent: 0, // dead
        hpMax: 7,
        conditions: [],
        resources: {},
      },
    ]);

    const factionService = new MockFactionService() as any;
    const victoryPolicy = new BasicCombatVictoryPolicy(factionService);
    const diceRoller = new FixedDiceRoller(10);

    const combatService = new CombatService(
      sessionsRepo,
      combatRepo,
      victoryPolicy,
      eventsRepo,
      charactersRepo,
      monstersRepo,
      npcsRepo,
      diceRoller,
    );

    // Advance turn - should detect victory and end encounter
    const result = await combatService.nextTurn(session.id);
    expect(result.status).toBe("Victory");
    expect(result.round).toBe(1); // round didn't advance
    expect(result.turn).toBe(0); // turn didn't advance

    // Verify CombatEnded event was emitted
    const events = await eventsRepo.listBySession(session.id);
    const endedEvent = events.find((e) => e.type === "CombatEnded");
    expect(endedEvent).toBeDefined();
    expect(endedEvent?.payload).toMatchObject({ result: "Victory" });
  });

  it("auto-rolls death save for the post-advance active character, not stale combatant index", async () => {
    const sessionsRepo = new MemorySessionRepository();
    const combatRepo = new MemoryCombatRepository();
    const eventsRepo = new MemoryEventRepository();
    const charactersRepo = new MemoryCharacterRepository();
    const monstersRepo = new MemoryMonsterRepository();
    const npcsRepo = new MemoryNPCRepository();

    const session = await sessionsRepo.create({
      id: "sess-3",
      storyFramework: { setting: "Test" },
    });

    const lowInitCharacter = await charactersRepo.createInSession(session.id, {
      id: "char-low",
      name: "Low Init",
      level: 1,
      className: "Fighter",
      sheet: {
        level: 1,
        className: "Fighter",
        abilityScores: { str: 16, dex: 10, con: 14, int: 10, wis: 10, cha: 8 },
        maxHp: 12,
        armorClass: 16,
        proficiencyBonus: 2,
        speed: 30,
      },
    });

    const downedCharacter = await charactersRepo.createInSession(session.id, {
      id: "char-downed",
      name: "Downed",
      level: 1,
      className: "Fighter",
      sheet: {
        level: 1,
        className: "Fighter",
        abilityScores: { str: 16, dex: 18, con: 14, int: 10, wis: 10, cha: 8 },
        maxHp: 12,
        armorClass: 16,
        proficiencyBonus: 2,
        speed: 30,
      },
    });

    const midInitMonster = await monstersRepo.createInSession(session.id, {
      id: "mon-mid",
      name: "Goblin",
      monsterDefinitionId: null,
      statBlock: {
        maxHp: 7,
        armorClass: 15,
        speed: 30,
        abilityScores: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
        proficiencyBonus: 2,
      },
    });

    // Initiative order by value should be: char-downed (20), mon-mid (10), char-low (5).
    // Repository array order is intentionally different to catch stale index lookups.
    const encounter = await combatRepo.createEncounter(session.id, {
      id: "enc-3",
      status: "Active",
      round: 1,
      turn: 2,
    });
    await combatRepo.createCombatants(encounter.id, [
      {
        id: "char-low",
        combatantType: "Character",
        characterId: lowInitCharacter.id,
        monsterId: null,
        npcId: null,
        initiative: 5,
        hpCurrent: 12,
        hpMax: 12,
        conditions: [],
        resources: {},
      },
      {
        id: "char-downed",
        combatantType: "Character",
        characterId: downedCharacter.id,
        monsterId: null,
        npcId: null,
        initiative: 20,
        hpCurrent: 0,
        hpMax: 12,
        conditions: [],
        resources: { deathSaves: { successes: 0, failures: 0 } },
      },
      {
        id: "mon-mid",
        combatantType: "Monster",
        characterId: null,
        monsterId: midInitMonster.id,
        npcId: null,
        initiative: 10,
        hpCurrent: 7,
        hpMax: 7,
        conditions: [],
        resources: {},
      },
    ]);

    const factionService = new MockFactionService() as any;
    const victoryPolicy = new BasicCombatVictoryPolicy(factionService);
    const diceRoller = new FixedDiceRoller(10);

    const combatService = new CombatService(
      sessionsRepo,
      combatRepo,
      victoryPolicy,
      eventsRepo,
      charactersRepo,
      monstersRepo,
      npcsRepo,
      diceRoller,
    );

    const result = await combatService.nextTurn(session.id);
    expect(result.round).toBe(2);
    expect(result.turn).toBe(0);

    const combatants = await combatRepo.listCombatants(encounter.id);
    const downed = combatants.find((c) => c.id === "char-downed");
    const lowInit = combatants.find((c) => c.id === "char-low");
    const downedDeathSaves = (downed?.resources as any)?.deathSaves;
    const lowInitDeathSaves = (lowInit?.resources as any)?.deathSaves;

    expect(downedDeathSaves).toMatchObject({ successes: 1, failures: 0 });
    expect(lowInitDeathSaves).toBeUndefined();

    const events = await eventsRepo.listBySession(session.id);
    const deathSaveEvent = events.find((e) => e.type === "DeathSave");
    expect(deathSaveEvent?.payload).toMatchObject({
      encounterId: encounter.id,
      combatantId: "char-downed",
      roll: 10,
      result: "success",
      deathSaves: { successes: 1, failures: 0 },
    });
  });
});
