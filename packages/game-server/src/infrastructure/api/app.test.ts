import { describe, expect, it, afterEach } from "vitest";

import { buildApp } from "./app.js";
import { FixedDiceRoller } from "../../domain/rules/dice-roller.js";

import type {
  ICharacterRepository,
  ICombatRepository,
  IEventRepository,
  IGameSessionRepository,
  IMonsterRepository,
  INPCRepository,
  ISpellRepository,
} from "../../application/repositories/index.js";
import type {
  CombatantStateRecord,
  CombatEncounterRecord,
  GameEventRecord,
  GameSessionRecord,
  JsonValue,
  SessionCharacterRecord,
  SessionMonsterRecord,
  SessionNPCRecord,
  SpellDefinitionRecord,
} from "../../application/types.js";
import type { IStoryGenerator } from "../llm/story-generator.js";
import type { IIntentParser } from "../llm/intent-parser.js";
import type { INarrativeGenerator } from "../llm/narrative-generator.js";
import type { ICharacterGenerator } from "../llm/character-generator.js";

function now(): Date {
  return new Date();
}

class MemoryGameSessionRepository implements IGameSessionRepository {
  private readonly sessions = new Map<string, GameSessionRecord>();

  async create(input: { id: string; storyFramework: JsonValue }): Promise<GameSessionRecord> {
    const created: GameSessionRecord = {
      id: input.id,
      storyFramework: input.storyFramework,
      createdAt: now(),
      updatedAt: now(),
    };
    this.sessions.set(created.id, created);
    return created;
  }

  async getById(id: string): Promise<GameSessionRecord | null> {
    return this.sessions.get(id) ?? null;
  }
}

class MemoryCharacterRepository implements ICharacterRepository {
  private readonly characters = new Map<string, SessionCharacterRecord>();

  async createInSession(
    sessionId: string,
    input: { id: string; name: string; level: number; className: string | null; sheet: JsonValue },
  ): Promise<SessionCharacterRecord> {
    const created: SessionCharacterRecord = {
      id: input.id,
      sessionId,
      name: input.name,
      level: input.level,
      className: input.className,
      sheet: input.sheet,
      faction: "party",
      aiControlled: false,
      createdAt: now(),
      updatedAt: now(),
    };
    this.characters.set(created.id, created);
    return created;
  }

  async getById(id: string): Promise<SessionCharacterRecord | null> {
    return this.characters.get(id) ?? null;
  }

  async getManyByIds(ids: string[]): Promise<SessionCharacterRecord[]> {
    return ids.map((id) => this.characters.get(id)).filter((c): c is SessionCharacterRecord => c !== undefined);
  }

  async listBySession(sessionId: string): Promise<SessionCharacterRecord[]> {
    return [...this.characters.values()].filter((c) => c.sessionId === sessionId);
  }

  async updateSheet(id: string, sheet: JsonValue): Promise<SessionCharacterRecord> {
    const existing = this.characters.get(id);
    if (!existing) throw new Error("Character not found: " + id);
    const updated: SessionCharacterRecord = { ...existing, sheet, updatedAt: now() };
    this.characters.set(id, updated);
    return updated;
  }

  async delete(id: string): Promise<void> {
    this.characters.delete(id);
  }
}

class MemoryMonsterRepository implements IMonsterRepository {
  private readonly monsters = new Map<string, SessionMonsterRecord>();

  async createInSession(
    sessionId: string,
    input: { id: string; name: string; monsterDefinitionId: string | null; statBlock: JsonValue },
  ): Promise<SessionMonsterRecord> {
    const created: SessionMonsterRecord = {
      id: input.id,
      sessionId,
      name: input.name,
      monsterDefinitionId: input.monsterDefinitionId,
      statBlock: input.statBlock,
      faction: "enemy",
      aiControlled: true,
      createdAt: now(),
      updatedAt: now(),
    };
    this.monsters.set(created.id, created);
    return created;
  }

  async getById(id: string): Promise<SessionMonsterRecord | null> {
    return this.monsters.get(id) ?? null;
  }

  async getManyByIds(ids: string[]): Promise<SessionMonsterRecord[]> {
    return ids.map((id) => this.monsters.get(id)).filter((m): m is SessionMonsterRecord => m !== undefined);
  }

  async listBySession(sessionId: string): Promise<SessionMonsterRecord[]> {
    return [...this.monsters.values()].filter((m) => m.sessionId === sessionId);
  }

  async delete(id: string): Promise<void> {
    this.monsters.delete(id);
  }
}

class MemoryCombatRepository implements ICombatRepository {
  private readonly encounters = new Map<string, CombatEncounterRecord>();
  private readonly combatantsByEncounter = new Map<string, CombatantStateRecord[]>();
  private readonly pendingActionsByEncounter = new Map<string, JsonValue>();

  async createEncounter(
    sessionId: string,
    input: { id: string; status: string; round: number; turn: number; mapData?: JsonValue },
  ): Promise<CombatEncounterRecord> {
    const created: CombatEncounterRecord = {
      id: input.id,
      sessionId,
      status: input.status,
      round: input.round,
      turn: input.turn,
      mapData: input.mapData,
      createdAt: now(),
      updatedAt: now(),
    };
    this.encounters.set(created.id, created);
    return created;
  }

  async listEncountersBySession(sessionId: string): Promise<CombatEncounterRecord[]> {
    return [...this.encounters.values()]
      .filter((e) => e.sessionId === sessionId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async getEncounterById(id: string): Promise<CombatEncounterRecord | null> {
    return this.encounters.get(id) ?? null;
  }

  async updateEncounter(
    id: string,
    patch: Partial<Pick<CombatEncounterRecord, "status" | "round" | "turn" | "mapData">>,
  ): Promise<CombatEncounterRecord> {
    const existing = this.encounters.get(id);
    if (!existing) throw new Error("missing");
    const next: CombatEncounterRecord = {
      ...existing,
      ...patch,
      updatedAt: now(),
    };
    this.encounters.set(id, next);
    return next;
  }

  async listCombatants(encounterId: string): Promise<CombatantStateRecord[]> {
    const list = this.combatantsByEncounter.get(encounterId) ?? [];
    return [...list].sort((a, b) => {
      const ai = a.initiative ?? -Infinity;
      const bi = b.initiative ?? -Infinity;
      if (bi !== ai) return bi - ai;
      const ac = a.createdAt.getTime();
      const bc = b.createdAt.getTime();
      if (ac !== bc) return ac - bc;
      return a.id.localeCompare(b.id);
    });
  }

  async updateCombatantState(
    id: string,
    patch: Partial<Pick<CombatantStateRecord, "hpCurrent" | "hpMax" | "hpTemp" | "initiative" | "conditions" | "resources">>,
  ): Promise<CombatantStateRecord> {
    for (const [encounterId, list] of this.combatantsByEncounter.entries()) {
      const idx = list.findIndex((c) => c.id === id);
      if (idx === -1) continue;
      const existing = list[idx]!;
      const updated: CombatantStateRecord = {
        ...existing,
        ...patch,
        updatedAt: now(),
      };
      const next = [...list];
      next[idx] = updated;
      this.combatantsByEncounter.set(encounterId, next);
      return updated;
    }
    throw new Error("CombatantState not found");
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
    const baseTime = now().getTime();

    const created = combatants.map((c, i) => {
      const rec: CombatantStateRecord = {
        id: c.id,
        encounterId,
        combatantType: c.combatantType,
        characterId: c.characterId,
        monsterId: c.monsterId,
        npcId: c.npcId,
        initiative: c.initiative,
        hpCurrent: c.hpCurrent,
        hpMax: c.hpMax,
        hpTemp: c.hpTemp ?? 0,
        conditions: c.conditions,
        resources: c.resources,
        createdAt: new Date(baseTime + i),
        updatedAt: new Date(baseTime + i),
      };
      return rec;
    });

    this.combatantsByEncounter.set(encounterId, created);
    return created;
  }

  async setPendingAction(encounterId: string, action: JsonValue): Promise<void> {
    this.pendingActionsByEncounter.set(encounterId, action);
  }

  async getPendingAction(encounterId: string): Promise<JsonValue | null> {
    return this.pendingActionsByEncounter.get(encounterId) ?? null;
  }

  async clearPendingAction(encounterId: string): Promise<void> {
    this.pendingActionsByEncounter.delete(encounterId);
  }

  async findActiveEncounter(sessionId: string): Promise<CombatEncounterRecord | null> {
    const encounters = await this.listEncountersBySession(sessionId);
    return encounters.find((e) => e.status === "Active") ?? null;
  }

  async findById(encounterId: string): Promise<CombatEncounterRecord | null> {
    return this.getEncounterById(encounterId);
  }

  async startCombat(
    encounterId: string,
    initiatives: Record<string, number>,
  ): Promise<CombatEncounterRecord> {
    const combatants = await this.listCombatants(encounterId);
    await Promise.all(
      combatants.map((c) =>
        this.updateCombatantState(c.id, {
          initiative: initiatives[c.id] ?? c.initiative ?? null,
        }),
      ),
    );
    return this.updateEncounter(encounterId, { status: "Active" });
  }
}

class MemoryEventRepository implements IEventRepository {
  private readonly events: GameEventRecord[] = [];

  async append(
    sessionId: string,
    input: { id: string; type: string; payload: JsonValue },
  ): Promise<GameEventRecord> {
    const created: GameEventRecord = {
      id: input.id,
      sessionId,
      type: input.type,
      payload: input.payload,
      createdAt: now(),
    };
    this.events.push(created);
    return created;
  }

  async listBySession(
    sessionId: string,
    input?: { limit?: number; since?: Date },
  ): Promise<GameEventRecord[]> {
    const filtered = this.events
      .filter((e) => e.sessionId === sessionId)
      .filter((e) => (input?.since ? e.createdAt > input.since : true));

    const limit = input?.limit ?? 100;
    return filtered.slice(-limit);
  }
}

class MemorySpellRepository implements ISpellRepository {
  async getById(_id: string): Promise<SpellDefinitionRecord | null> {
    return null;
  }
  async getByName(_name: string): Promise<SpellDefinitionRecord | null> {
    return null;
  }
  async listByLevel(_level: number): Promise<SpellDefinitionRecord[]> {
    return [];
  }
}

class MemoryNPCRepository implements INPCRepository {
  private readonly npcs = new Map<string, SessionNPCRecord>();

  async createInSession(
    sessionId: string,
    input: { id: string; name: string; statBlock: JsonValue; faction?: string; aiControlled?: boolean },
  ): Promise<SessionNPCRecord> {
    const created: SessionNPCRecord = {
      id: input.id,
      sessionId,
      name: input.name,
      statBlock: input.statBlock,
      faction: input.faction ?? "neutral",
      aiControlled: input.aiControlled ?? false,
      createdAt: now(),
      updatedAt: now(),
    };
    this.npcs.set(created.id, created);
    return created;
  }

  async getById(id: string): Promise<SessionNPCRecord | null> {
    return this.npcs.get(id) ?? null;
  }

  async getManyByIds(ids: string[]): Promise<SessionNPCRecord[]> {
    return ids.map((id) => this.npcs.get(id)).filter((n): n is SessionNPCRecord => n !== undefined);
  }

  async listBySession(sessionId: string): Promise<SessionNPCRecord[]> {
    return [...this.npcs.values()].filter((n) => n.sessionId === sessionId);
  }

  async delete(id: string): Promise<void> {
    this.npcs.delete(id);
  }
}

function buildTestApp(overrides?: {
  storyGenerator?: IStoryGenerator;
  intentParser?: IIntentParser;
  narrativeGenerator?: INarrativeGenerator;
  characterGenerator?: ICharacterGenerator;
}) {
  const sessionsRepo = new MemoryGameSessionRepository();
  const charactersRepo = new MemoryCharacterRepository();
  const monstersRepo = new MemoryMonsterRepository();
  const npcsRepo = new MemoryNPCRepository();
  const combatRepo = new MemoryCombatRepository();
  const eventsRepo = new MemoryEventRepository();
  const spellsRepo = new MemorySpellRepository();

  const app = buildApp({
    sessionsRepo,
    charactersRepo,
    monstersRepo,
    npcsRepo,
    combatRepo,
    eventsRepo,
    spellsRepo,
    diceRoller: new FixedDiceRoller(10),
    storyGenerator: overrides?.storyGenerator,
    intentParser: overrides?.intentParser,
    narrativeGenerator: overrides?.narrativeGenerator,
    characterGenerator: overrides?.characterGenerator,
  });

  return { app };
}

describe("game-server api", () => {
  afterEach(async () => {
    // no-op (apps are per-test)
  });

  it("GET /health returns ok", async () => {
    const { app } = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });

  it("POST /sessions creates a session", async () => {
    const { app } = buildTestApp();
    const res = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { storyFramework: { opening: "hi" } },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(typeof body.id).toBe("string");
    expect(body.storyFramework).toEqual({ opening: "hi" });
    await app.close();
  });

  it("POST /sessions generates storyFramework when omitted", async () => {
    const storyGenerator: IStoryGenerator = {
      async generateStoryFramework() {
        return {
          opening: "You wake in a torchlit ruin.",
          arc: "- Find the key\n- Reach the gate\n- Confront the cult",
          ending: "The portal closes as the idol shatters.",
          checkpoints: [{ id: "cp1", description: "Gain the map", trigger: "Defeat the scouts" }],
        };
      },
    };

    const { app } = buildTestApp({ storyGenerator });
    const res = await app.inject({ method: "POST", url: "/sessions" });

    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.storyFramework.opening).toBe("You wake in a torchlit ruin.");
    expect(body.storyFramework.checkpoints).toHaveLength(1);
    await app.close();
  });

  it("POST /sessions/:id/llm/intent returns parsed intent", async () => {
    const intentParser: IIntentParser = {
      async parseIntent() {
        return {
          kind: "attack",
          attacker: { type: "Character", characterId: "char_1" },
          target: { type: "Monster", monsterId: "mon_1" },
          seed: 123,
          spec: { kind: "melee", attackBonus: 5, damage: { diceCount: 1, diceSize: 8, bonus: 3 } },
        };
      },
    };

    const { app } = buildTestApp({ intentParser });
    const createdSession = await app.inject({ method: "POST", url: "/sessions", payload: { storyFramework: {} } });
    const sessionId = (createdSession.json() as any).id as string;

    const res = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/llm/intent`,
      payload: { text: "I attack the goblin", schemaHint: "{ kind: 'attack', target: string }" },
    });

    expect(res.statusCode).toBe(200);
    expect((res.json() as any).command.kind).toBe("attack");
    await app.close();
  });

  it("POST /sessions/:id/llm/narrate returns narrative", async () => {
    const narrativeGenerator: INarrativeGenerator = {
      async narrate() {
        return "Steel flashes; the goblin staggers.";
      },
    };

    const { app } = buildTestApp({ narrativeGenerator });
    const createdSession = await app.inject({ method: "POST", url: "/sessions", payload: { storyFramework: {} } });
    const sessionId = (createdSession.json() as any).id as string;

    const res = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/llm/narrate`,
      payload: { events: [{ type: "AttackResolved", payload: { hit: true, damage: 8 } }] },
    });

    expect(res.statusCode).toBe(200);
    expect((res.json() as any).narrative).toBe("Steel flashes; the goblin staggers.");
    await app.close();
  });

  it("POST /sessions/:id/llm/act parses and executes endTurn", async () => {
    let actorCharacterId = "";

    const intentParser: IIntentParser = {
      async parseIntent() {
        return {
          kind: "endTurn",
          actor: { type: "Character", characterId: actorCharacterId },
        };
      },
    };

    const { app } = buildTestApp({ intentParser });
    const createdSession = await app.inject({ method: "POST", url: "/sessions", payload: { storyFramework: {} } });
    const sessionId = (createdSession.json() as any).id as string;

    const createdChar = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: {
        name: "Talia",
        level: 1,
        className: "wizard",
        sheet: { hp: 8, armorClass: 12, abilityScores: { strength: 10, dexterity: 14, constitution: 12, intelligence: 16, wisdom: 10, charisma: 10 } },
      },
    });
    actorCharacterId = (createdChar.json() as any).id as string;

    const started = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/start`,
      payload: {
        combatants: [
          {
            combatantType: "Character",
            characterId: actorCharacterId,
            initiative: 10,
            hpCurrent: 8,
            hpMax: 8,
            conditions: {},
            resources: { actionSpent: false },
          },
        ],
      },
    });
    expect(started.statusCode).toBe(200);

    const res = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/llm/act`,
      payload: { text: "I end my turn" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.command.kind).toBe("endTurn");
    // One-combatant encounter wraps immediately: round increments, turn resets to 0.
    expect(body.outcome.round).toBe(2);
    expect(body.outcome.turn).toBe(0);

    await app.close();
  });

  it("POST /sessions/:id/llm/act parses and executes attack", async () => {
    let attackerId = "";
    let targetId = "";

    const intentParser: IIntentParser = {
      async parseIntent() {
        return {
          kind: "attack",
          seed: 123,
          attacker: { type: "Character", characterId: attackerId },
          target: { type: "Character", characterId: targetId },
          spec: {
            kind: "melee",
            attackBonus: 100,
            damage: { diceCount: 1, diceSides: 6, modifier: 0 },
          },
        };
      },
    };

    const { app } = buildTestApp({ intentParser });
    const createdSession = await app.inject({ method: "POST", url: "/sessions", payload: { storyFramework: {} } });
    const sessionId = (createdSession.json() as any).id as string;

    const attacker = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: {
        name: "Attacker",
        level: 1,
        className: "fighter",
        sheet: {
          armorClass: 10,
          abilityScores: {
            strength: 16,
            dexterity: 10,
            constitution: 12,
            intelligence: 10,
            wisdom: 10,
            charisma: 10,
          },
        },
      },
    });
    attackerId = (attacker.json() as any).id as string;

    const target = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: {
        name: "Target",
        level: 1,
        className: "fighter",
        sheet: {
          armorClass: 10,
          abilityScores: {
            strength: 10,
            dexterity: 10,
            constitution: 10,
            intelligence: 10,
            wisdom: 10,
            charisma: 10,
          },
        },
      },
    });
    targetId = (target.json() as any).id as string;

    const started = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/start`,
      payload: {
        combatants: [
          { combatantType: "Character", characterId: attackerId, initiative: 20, hpCurrent: 10, hpMax: 10 },
          { combatantType: "Character", characterId: targetId, initiative: 5, hpCurrent: 10, hpMax: 10 },
        ],
      },
    });
    expect(started.statusCode).toBe(200);

    const res = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/llm/act`,
      payload: { text: "I attack the target" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.command.kind).toBe("attack");
    expect(body.outcome?.result?.hit).toBe(true);
    expect(typeof body.outcome?.result?.damage?.applied).toBe("number");
    expect(body.outcome?.target?.hpCurrent).toBe(10 - body.outcome.result.damage.applied);

    await app.close();
  });

  it("session flow: add character then GET /sessions/:id returns it", async () => {
    const { app } = buildTestApp();

    const createdSession = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { storyFramework: {} },
    });
    const sessionId = (createdSession.json() as any).id as string;

    const createdChar = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: {
        name: "Talia",
        level: 1,
        className: "wizard",
        sheet: { hp: 8 },
      },
    });
    expect(createdChar.statusCode).toBe(200);

    const get = await app.inject({ method: "GET", url: `/sessions/${sessionId}` });
    expect(get.statusCode).toBe(200);

    const payload = get.json() as any;
    expect(payload.session.id).toBe(sessionId);
    expect(payload.characters).toHaveLength(1);
    expect(payload.characters[0].name).toBe("Talia");

    await app.close();
  });

  it("POST /sessions/:id/characters rejects invalid className", async () => {
    const { app } = buildTestApp();

    const createdSession = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { storyFramework: {} },
    });
    const sessionId = (createdSession.json() as any).id as string;

    const res = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: {
        name: "BadClass",
        level: 1,
        className: "fihgter",
        sheet: { hp: 10 },
      },
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as any).message).toContain("Unknown character class");

    await app.close();
  });

  it("POST /sessions/:id/characters accepts valid className (case-insensitive)", async () => {
    const { app } = buildTestApp();

    const createdSession = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { storyFramework: {} },
    });
    const sessionId = (createdSession.json() as any).id as string;

    const res = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: {
        name: "ValidFighter",
        level: 1,
        className: "Fighter",
        sheet: { hp: 12 },
      },
    });
    expect(res.statusCode).toBe(200);

    await app.close();
  });

  it("POST /sessions/:id/characters accepts null className", async () => {
    const { app } = buildTestApp();

    const createdSession = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { storyFramework: {} },
    });
    const sessionId = (createdSession.json() as any).id as string;

    const res = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: {
        name: "NoClass",
        level: 1,
        sheet: { hp: 6 },
      },
    });
    expect(res.statusCode).toBe(200);

    await app.close();
  });

  it("DELETE /sessions/:id/characters/:characterId removes character", async () => {
    const { app } = buildTestApp();

    const createdSession = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { storyFramework: {} },
    });
    const sessionId = (createdSession.json() as any).id as string;

    const charRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: { name: "ToDelete", level: 1, sheet: { hp: 8 } },
    });
    expect(charRes.statusCode).toBe(200);
    const characterId = (charRes.json() as any).id as string;

    const delRes = await app.inject({
      method: "DELETE",
      url: `/sessions/${sessionId}/characters/${characterId}`,
    });
    expect(delRes.statusCode).toBe(200);
    expect((delRes.json() as any).deleted).toBe(true);

    // Verify character is gone
    const getRes = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}`,
    });
    const session = getRes.json() as any;
    const charIds = (session.characters ?? []).map((c: any) => c.id);
    expect(charIds).not.toContain(characterId);

    await app.close();
  });

  it("DELETE /sessions/:id/characters/:characterId returns 404 for non-existent character", async () => {
    const { app } = buildTestApp();

    const createdSession = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { storyFramework: {} },
    });
    const sessionId = (createdSession.json() as any).id as string;

    const delRes = await app.inject({
      method: "DELETE",
      url: `/sessions/${sessionId}/characters/nonexistent`,
    });
    expect(delRes.statusCode).toBe(404);

    await app.close();
  });

  it("POST /sessions/:id/combat/start validates character combatant ids", async () => {
    const { app } = buildTestApp();

    const createdSession = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { storyFramework: {} },
    });
    const sessionId = (createdSession.json() as any).id as string;

    const res = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/start`,
      payload: {
        combatants: [
          {
            combatantType: "Character",
            hpCurrent: 10,
            hpMax: 10,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as any;
    expect(body.error).toBe("ValidationError");

    await app.close();
  });

  it("POST /sessions/:id/combat/next advances turn", async () => {
    const { app } = buildTestApp();

    const createdSession = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { storyFramework: {} },
    });
    const sessionId = (createdSession.json() as any).id as string;

    const char = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: { name: "Talia", level: 1, className: "wizard", sheet: {} },
    });
    const characterId = (char.json() as any).id as string;

    const encounter = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/start`,
      payload: {
        combatants: [
          { combatantType: "Character", characterId, hpCurrent: 10, hpMax: 10 },
          { combatantType: "Character", characterId, hpCurrent: 10, hpMax: 10 },
        ],
      },
    });
    const encounterId = (encounter.json() as any).id as string;

    const next = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/next`,
      payload: { encounterId },
    });

    expect(next.statusCode).toBe(200);
    const updated = next.json() as any;
    expect(updated.turn).toBe(1);
    expect(updated.round).toBe(1);

    await app.close();
  });

  it("GET /sessions/:id/combat returns ordered combat state", async () => {
    const { app } = buildTestApp();

    const createdSession = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { storyFramework: {} },
    });
    const sessionId = (createdSession.json() as any).id as string;

    const char1 = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: { name: "Fast", level: 1, className: "fighter", sheet: {} },
    });
    const characterId1 = (char1.json() as any).id as string;

    const char2 = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: { name: "Slow", level: 1, className: "fighter", sheet: {} },
    });
    const characterId2 = (char2.json() as any).id as string;

    const encounter = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/start`,
      payload: {
        combatants: [
          { combatantType: "Character", characterId: characterId1, initiative: 20, hpCurrent: 10, hpMax: 10 },
          { combatantType: "Character", characterId: characterId2, initiative: 5, hpCurrent: 10, hpMax: 10 },
        ],
      },
    });
    const encounterId = (encounter.json() as any).id as string;

    const res = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/combat?encounterId=${encodeURIComponent(encounterId)}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.encounter.id).toBe(encounterId);
    expect(body.combatants).toHaveLength(2);
    expect(body.combatants[0].initiative).toBe(20);
    expect(body.activeCombatant.id).toBe(body.combatants[0].id);

    await app.close();
  });

  it("GET /sessions/:id/combat/:encounterId/tactical returns positions in feet and distances", async () => {
    const { app } = buildTestApp();

    const createdSession = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { storyFramework: {} },
    });
    const sessionId = (createdSession.json() as any).id as string;

    const char = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: { name: "Mover", level: 1, className: "fighter", sheet: {} },
    });
    const characterId = (char.json() as any).id as string;

    const mon = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/monsters`,
      payload: { name: "Goblin", statBlock: { hp: 7 } },
    });
    const monsterId = (mon.json() as any).id as string;

    const encounter = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/start`,
      payload: {
        combatants: [
          { combatantType: "Character", characterId, initiative: 20, hpCurrent: 10, hpMax: 10 },
          { combatantType: "Monster", monsterId, initiative: 10, hpCurrent: 7, hpMax: 7 },
        ],
      },
    });
    const encounterId = (encounter.json() as any).id as string;

    const res = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/combat/${encounterId}/tactical`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.encounterId).toBe(encounterId);
    expect(typeof body.activeCombatantId).toBe("string");
    expect(body.combatants).toHaveLength(2);
    for (const c of body.combatants) {
      expect(c.position).not.toBeNull();
      expect(typeof c.position.x).toBe("number");
      expect(typeof c.position.y).toBe("number");
      // distanceFromActive is number or null if positions missing
      if (c.distanceFromActive !== null) expect(typeof c.distanceFromActive).toBe("number");

      expect(c.actionEconomy).toBeTruthy();
      expect(typeof c.actionEconomy.actionAvailable).toBe("boolean");
      expect(typeof c.actionEconomy.bonusActionAvailable).toBe("boolean");
      expect(typeof c.actionEconomy.reactionAvailable).toBe("boolean");
      expect(typeof c.actionEconomy.movementRemainingFeet).toBe("number");

      expect(Array.isArray(c.resourcePools)).toBe(true);
    }

    await app.close();
  });

  it("tabletop initiative flow assigns positions (tactical has positions)", async () => {
    const intentParser: IIntentParser = {
      async parseIntent() {
        // Empty intent is fine; initiate flow falls back to raw text matching.
        return {} as any;
      },
    };

    const { app } = buildTestApp({ intentParser });

    const createdSession = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { storyFramework: {} },
    });
    const sessionId = (createdSession.json() as any).id as string;

    const char = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: { name: "Hero", level: 1, className: "fighter", sheet: {} },
    });
    const characterId = (char.json() as any).id as string;

    await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/monsters`,
      payload: { name: "Goblin Warrior", statBlock: { hp: 7 } },
    });

    const init = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/initiate`,
      payload: { text: "I attack the Goblin Warrior", actorId: characterId },
    });
    expect(init.statusCode).toBe(200);

    const roll = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/roll-result`,
      payload: { text: "I rolled 18", actorId: characterId },
    });
    expect(roll.statusCode).toBe(200);
    const rollBody = roll.json() as any;
    expect(typeof rollBody.encounterId).toBe("string");

    const tactical = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/combat/${rollBody.encounterId}/tactical`,
    });
    expect(tactical.statusCode).toBe(200);
    const tacticalBody = tactical.json() as any;

    expect(Array.isArray(tacticalBody.combatants)).toBe(true);
    expect(tacticalBody.combatants.length).toBeGreaterThanOrEqual(2);
    for (const c of tacticalBody.combatants) {
      expect(c.position).not.toBeNull();
      expect(typeof c.position.x).toBe("number");
      expect(typeof c.position.y).toBe("number");
    }

    await app.close();
  });

  it("tabletop initiative flow includes all session monsters", async () => {
    const intentParser: IIntentParser = {
      async parseIntent() {
        return {} as any;
      },
    };

    const { app } = buildTestApp({ intentParser });

    const createdSession = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { storyFramework: {} },
    });
    const sessionId = (createdSession.json() as any).id as string;

    const char = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: { name: "Hero", level: 1, className: "fighter", sheet: {} },
    });
    const characterId = (char.json() as any).id as string;

    const mon1 = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/monsters`,
      payload: { name: "Goblin Warrior", statBlock: { hp: 7 } },
    });
    const monster1Id = (mon1.json() as any).id as string;

    await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/monsters`,
      payload: { name: "Goblin Archer", statBlock: { hp: 7 } },
    });

    const init = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/initiate`,
      payload: { text: "I attack the Goblin Warrior", actorId: characterId },
    });
    expect(init.statusCode).toBe(200);

    const roll = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/roll-result`,
      payload: { text: "I rolled 18", actorId: characterId },
    });
    expect(roll.statusCode).toBe(200);
    const rollBody = roll.json() as any;
    expect(typeof rollBody.encounterId).toBe("string");

    const tactical = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/combat/${rollBody.encounterId}/tactical`,
    });
    expect(tactical.statusCode).toBe(200);
    const tacticalBody = tactical.json() as any;

    const monsterNames = (tacticalBody.combatants as any[])
      .filter((c) => c.combatantType === "Monster")
      .map((c) => c.name);
    expect(monsterNames).toEqual(expect.arrayContaining(["Goblin Warrior", "Goblin Archer"]));

    await app.close();
  });

  it("combat start default placement starts hostiles within 30ft", async () => {
    const { app } = buildTestApp();

    const createdSession = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { storyFramework: {} },
    });
    const sessionId = (createdSession.json() as any).id as string;

    const char = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: { name: "Hero", level: 1, className: "fighter", sheet: {} },
    });
    const characterId = (char.json() as any).id as string;

    const mon = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/monsters`,
      payload: { name: "Goblin", statBlock: { hp: 7 } },
    });
    const monsterId = (mon.json() as any).id as string;

    const started = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/start`,
      payload: {
        combatants: [
          { combatantType: "Character", characterId, hpCurrent: 10, hpMax: 10 },
          { combatantType: "Monster", monsterId, hpCurrent: 7, hpMax: 7 },
        ],
      },
    });
    expect(started.statusCode).toBe(200);
    const encounterId = (started.json() as any).id as string;

    const tactical = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/combat/${encounterId}/tactical`,
    });
    expect(tactical.statusCode).toBe(200);
    const tacticalBody = tactical.json() as any;

    const active = (tacticalBody.combatants as any[]).find((c) => c.id === tacticalBody.activeCombatantId);
    expect(active?.combatantType).toBe("Character");

    const goblin = (tacticalBody.combatants as any[]).find((c) => c.combatantType === "Monster");
    expect(goblin).toBeTruthy();
    expect(goblin.distanceFromActive).toBe(30);

    await app.close();
  });

  it("tabletop attack roll flow uses spec and does not auto-end the player's turn", async () => {
    const intentParser: IIntentParser = {
      async parseIntent({ text, schemaHint }: any) {
        // Pull the roster out of the schema hint so we can return valid IDs.
        const rosterJson =
          typeof schemaHint === "string" && schemaHint.includes("Roster (valid IDs):")
            ? schemaHint.split("Roster (valid IDs):").pop()?.trim()
            : null;
        const roster = rosterJson ? (JSON.parse(rosterJson) as any) : null;
        const characterId = roster?.characters?.[0]?.id as string | undefined;
        const monsterId = roster?.monsters?.[0]?.id as string | undefined;

        if (typeof text === "string" && text.toLowerCase().includes("attack") && characterId && monsterId) {
          // Return a deterministic attack command matching the schema.
          // Simulate: "unarmed strike" (1d6+4) with +7 to hit.
          return {
            kind: "attack",
            attacker: { type: "Character", characterId },
            target: { type: "Monster", monsterId },
            spec: {
              kind: "melee",
              attackBonus: 7,
              damage: { diceCount: 1, diceSides: 6, modifier: 4 },
            },
          } as any;
        }

        return {} as any;
      },
    };

    const { app } = buildTestApp({ intentParser });

    const createdSession = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { storyFramework: {} },
    });
    const sessionId = (createdSession.json() as any).id as string;

    const char = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: { name: "Hero", level: 5, className: "monk", sheet: { abilityScores: { dexterity: 18 }, maxHp: 45 } },
    });
    const characterId = (char.json() as any).id as string;

    const mon = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/monsters`,
      payload: { name: "Goblin Warrior", statBlock: { hp: 7, armorClass: 15 } },
    });
    const monsterId = (mon.json() as any).id as string;

    // Start an encounter with adjacent positions so melee attacks are in reach.
    const started = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/start`,
      payload: {
        combatants: [
          {
            combatantType: "Character",
            characterId,
            initiative: 20,
            hpCurrent: 45,
            hpMax: 45,
            resources: { position: { x: 10, y: 10 }, speed: 30 },
          },
          {
            combatantType: "Monster",
            monsterId,
            initiative: 10,
            hpCurrent: 7,
            hpMax: 7,
            resources: { position: { x: 15, y: 10 }, speed: 30 },
          },
        ],
      },
    });
    expect(started.statusCode).toBe(200);
    const encounterId = (started.json() as any).id as string;

    // Attack action should create a pending ATTACK roll request.
    const act = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/action`,
      payload: { text: "attack with unarmed strike", actorId: characterId, encounterId },
    });
    expect(act.statusCode).toBe(200);
    const actBody = act.json() as any;
    expect(actBody.requiresPlayerInput).toBe(true);
    expect(actBody.rollType).toBe("attack");

    // Resolve attack roll -> should request damage with dice from spec.
    // Use a non-20 roll to avoid critical hit doubling the dice formula.
    const rollAtk = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/roll-result`,
      payload: { text: "I rolled 15", actorId: characterId },
    });
    expect(rollAtk.statusCode).toBe(200);
    const atkBody = rollAtk.json() as any;
    expect(atkBody.requiresPlayerInput).toBe(true);
    expect(atkBody.rollType).toBe("damage");
    expect(atkBody.diceNeeded).toBe("1d8+4");

    // Resolve damage roll.
    const rollDmg = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/roll-result`,
      payload: { text: "I rolled 3", actorId: characterId },
    });
    expect(rollDmg.statusCode).toBe(200);

    // Verify it's still the character's turn (no auto-advance).
    const state = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/combat?encounterId=${encounterId}`,
    });
    expect(state.statusCode).toBe(200);
    const stateBody = state.json() as any;
    expect(stateBody.activeCombatant?.combatantType).toBe("Character");
    expect(stateBody.activeCombatant?.characterId).toBe(characterId);

    // Verify the goblin exists and is the same one.
    const goblin = (stateBody.combatants as any[]).find((c) => c.monsterId === monsterId);
    expect(goblin).toBeTruthy();

    await app.close();
  });

  it("tabletop damage roll emits damage reaction opportunity for eligible character targets", async () => {
    const intentParser: IIntentParser = {
      async parseIntent({ text, schemaHint }: any) {
        const rosterJson =
          typeof schemaHint === "string" && schemaHint.includes("Roster (valid IDs):")
            ? schemaHint.split("Roster (valid IDs):").pop()?.trim()
            : null;
        const roster = rosterJson ? (JSON.parse(rosterJson) as any) : null;
        const attackerId = roster?.characters?.[0]?.id as string | undefined;
        const targetId = roster?.characters?.[1]?.id as string | undefined;

        if (typeof text === "string" && text.toLowerCase().includes("attack") && attackerId && targetId) {
          return {
            kind: "attack",
            attacker: { type: "Character", characterId: attackerId },
            target: { type: "Character", characterId: targetId },
            spec: {
              kind: "melee",
              attackBonus: 7,
              damage: { diceCount: 1, diceSides: 8, modifier: 4 },
              damageType: "slashing",
            },
          } as any;
        }

        return {} as any;
      },
    };

    const { app } = buildTestApp({ intentParser });

    const createdSession = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { storyFramework: {} },
    });
    const sessionId = (createdSession.json() as any).id as string;

    const attackerRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: {
        name: "Attacker",
        level: 5,
        className: "fighter",
        sheet: {
          armorClass: 16,
          abilityScores: { strength: 18, dexterity: 12, constitution: 14 },
          proficiencyBonus: 3,
          maxHp: 38,
          attacks: [
            {
              name: "Longsword",
              kind: "melee",
              attackBonus: 7,
              damage: { diceCount: 1, diceSides: 8, modifier: 4 },
              damageType: "slashing",
            },
          ],
        },
      },
    });
    const attackerId = (attackerRes.json() as any).id as string;

    const targetRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: {
        name: "Hexblade",
        level: 5,
        className: "warlock",
        sheet: {
          armorClass: 12,
          abilityScores: { strength: 10, dexterity: 14, constitution: 14, charisma: 16 },
          proficiencyBonus: 3,
          maxHp: 30,
          resources: {
            hasHellishRebukePrepared: true,
            reactionUsed: false,
            resourcePools: [{ name: "pactMagic", current: 2, max: 2 }],
          },
        },
      },
    });
    const targetId = (targetRes.json() as any).id as string;

    const started = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/start`,
      payload: {
        combatants: [
          {
            combatantType: "Character",
            characterId: attackerId,
            initiative: 20,
            hpCurrent: 38,
            hpMax: 38,
            resources: { position: { x: 10, y: 10 }, speed: 30 },
          },
          {
            combatantType: "Character",
            characterId: targetId,
            initiative: 10,
            hpCurrent: 30,
            hpMax: 30,
            resources: {
              position: { x: 15, y: 10 },
              speed: 30,
              hasHellishRebukePrepared: true,
              reactionUsed: false,
              resourcePools: [{ name: "pactMagic", current: 2, max: 2 }],
            },
          },
        ],
      },
    });
    expect(started.statusCode).toBe(200);
    const encounterId = (started.json() as any).id as string;

    const stateRes = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/combat?encounterId=${encounterId}`,
    });
    expect(stateRes.statusCode).toBe(200);
    const stateBody = stateRes.json() as any;
    const targetCombatant = (stateBody.combatants as any[]).find((c) => c.characterId === targetId);
    expect(targetCombatant).toBeTruthy();

    const patchTargetRes = await app.inject({
      method: "PATCH",
      url: `/sessions/${sessionId}/combat/${encounterId}/combatants/${targetCombatant.id}`,
      payload: {
        resources: {
          ...(targetCombatant.resources ?? {}),
          hasHellishRebukePrepared: true,
          reactionUsed: false,
          resourcePools: [{ name: "pactMagic", current: 2, max: 2 }],
        },
      },
    });
    expect(patchTargetRes.statusCode).toBe(200);

    const actionRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/action`,
      payload: { text: "attack Hexblade with Longsword", actorId: attackerId, encounterId },
    });
    expect(actionRes.statusCode).toBe(200);
    const actionBody = actionRes.json() as any;
    expect(actionBody.rollType).toBe("attack");

    const attackRollRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/roll-result`,
      payload: { text: "I rolled 15", actorId: attackerId },
    });
    expect(attackRollRes.statusCode).toBe(200);
    const attackRollBody = attackRollRes.json() as any;
    expect(attackRollBody.rollType).toBe("damage");

    const damageRollRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/roll-result`,
      payload: { text: "I rolled 6", actorId: attackerId },
    });
    expect(damageRollRes.statusCode).toBe(200);
    const damageRollBody = damageRollRes.json() as any;
    expect(damageRollBody.damageReaction).toBeTruthy();
    expect(damageRollBody.damageReaction.reactionType).toBe("hellish_rebuke");
    expect(typeof damageRollBody.damageReaction.pendingActionId).toBe("string");

    const pendingReactionsRes = await app.inject({
      method: "GET",
      url: `/encounters/${encounterId}/reactions`,
    });
    expect(pendingReactionsRes.statusCode).toBe(200);
    const pendingReactionsBody = pendingReactionsRes.json() as any;
    const damageReactionPending = (pendingReactionsBody.pendingActions as any[]).find(
      (action) => action.id === damageRollBody.damageReaction.pendingActionId,
    );
    expect(damageReactionPending).toBeTruthy();
    expect(damageReactionPending.type).toBe("damage_reaction");
    expect(damageReactionPending.reactionOpportunities[0].reactionType).toBe("hellish_rebuke");

    const eventsRes = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/events-json?limit=100`,
    });
    expect(eventsRes.statusCode).toBe(200);
    const eventsBody = eventsRes.json() as any[];
    const reactionPrompt = eventsBody.find(
      (event) => event.type === "ReactionPrompt" && event.payload?.pendingActionId === damageRollBody.damageReaction.pendingActionId,
    );
    expect(reactionPrompt).toBeTruthy();

    await app.close();
  });

  it("POST /sessions/:id/combat/action supports direct move text without LLM", async () => {
    const { app } = buildTestApp();

    const createdSession = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { storyFramework: {} },
    });
    const sessionId = (createdSession.json() as any).id as string;

    const char = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: { name: "Mover", level: 1, className: "fighter", sheet: {} },
    });
    const characterId = (char.json() as any).id as string;

    const encounter = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/start`,
      payload: {
        combatants: [
          { combatantType: "Character", characterId, initiative: 20, hpCurrent: 10, hpMax: 10 },
        ],
      },
    });
    const encounterId = (encounter.json() as any).id as string;

    const moveRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/action`,
      payload: { text: "move to (20, 10)", actorId: characterId, encounterId },
    });

    expect(moveRes.statusCode).toBe(200);
    const moveBody = moveRes.json() as any;
    expect(moveBody.type).toBe("MOVE_COMPLETE");
    expect(moveBody.actionComplete).toBe(true);
    expect(moveBody.movedTo).toEqual({ x: 20, y: 10 });

    const tactical = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/combat/${encounterId}/tactical`,
    });
    const tBody = tactical.json() as any;
    const mover = tBody.combatants.find((c: any) => c.combatantType === "Character");
    expect(mover.position).toEqual({ x: 20, y: 10 });

    await app.close();
  });

  it("POST /sessions/:id/combat/action move can return REACTION_CHECK and completes after reaction responses", async () => {
    const { app } = buildTestApp();

    const createdSession = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { storyFramework: {} },
    });
    const sessionId = (createdSession.json() as any).id as string;

    const char = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: { name: "Mover", level: 1, className: "fighter", sheet: {} },
    });
    const characterId = (char.json() as any).id as string;

    const mon = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/monsters`,
      payload: { name: "Goblin", statBlock: { hp: 7 } },
    });
    const monsterId = (mon.json() as any).id as string;

    const encounter = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/start`,
      payload: {
        combatants: [
          {
            combatantType: "Character",
            characterId,
            initiative: 20,
            hpCurrent: 10,
            hpMax: 10,
            resources: { position: { x: 0, y: 0 }, speed: 30 },
          },
          {
            combatantType: "Monster",
            monsterId,
            initiative: 10,
            hpCurrent: 7,
            hpMax: 7,
            resources: { position: { x: 5, y: 0 }, speed: 30, reach: 5 },
          },
        ],
      },
    });
    const encounterId = (encounter.json() as any).id as string;

    const moveRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/action`,
      payload: { text: "move to 20 0", actorId: characterId, encounterId },
    });

    expect(moveRes.statusCode).toBe(200);
    const moveBody = moveRes.json() as any;
    expect(moveBody.type).toBe("REACTION_CHECK");
    expect(typeof moveBody.pendingActionId).toBe("string");
    expect(Array.isArray(moveBody.opportunityAttacks)).toBe(true);

    const oa = moveBody.opportunityAttacks.find((x: any) => x.canAttack === true);
    expect(oa).toBeTruthy();
    expect(typeof oa.opportunityId).toBe("string");

    // Decline the OA to keep the test deterministic
    // Server auto-completes the move when all reactions are declined
    const respond = await app.inject({
      method: "POST",
      url: `/encounters/${encounterId}/reactions/${moveBody.pendingActionId}/respond`,
      payload: {
        combatantId: oa.combatantId,
        opportunityId: oa.opportunityId,
        choice: "decline",
      },
    });
    expect(respond.statusCode).toBe(200);
    const respondBody = respond.json() as any;
    expect(respondBody.status).toBe("completed");
    expect(respondBody.moveResult).toBeTruthy();
    expect(respondBody.moveResult.to).toEqual({ x: 20, y: 0 });

    await app.close();
  });

  it("POST /sessions/:id/combat/action cast spell can return REACTION_CHECK for Counterspell", async () => {
    const { app } = buildTestApp();

    const createdSession = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { storyFramework: {} },
    });
    const sessionId = (createdSession.json() as any).id as string;

    const casterRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: {
        name: "Caster Mage",
        level: 5,
        className: "wizard",
        sheet: {
          armorClass: 15,
          abilityScores: {
            strength: 8,
            dexterity: 14,
            constitution: 12,
            intelligence: 16,
            wisdom: 12,
            charisma: 10,
          },
          preparedSpells: [{ name: "Hold Person", level: 2 }],
        },
      },
    });
    const casterId = (casterRes.json() as any).id as string;

    const counterRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: {
        name: "Counter Mage",
        level: 5,
        className: "wizard",
        sheet: {
          armorClass: 15,
          abilityScores: {
            strength: 8,
            dexterity: 14,
            constitution: 12,
            intelligence: 16,
            wisdom: 12,
            charisma: 10,
          },
          preparedSpells: [{ name: "Counterspell", level: 3 }],
          spellSlots: { 3: 2 },
        },
      },
    });
    const counterId = (counterRes.json() as any).id as string;

    const encounter = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/start`,
      payload: {
        combatants: [
          {
            combatantType: "Character",
            characterId: casterId,
            initiative: 20,
            hpCurrent: 24,
            hpMax: 24,
            resources: {
              position: { x: 0, y: 0 },
              speed: 30,
              reactionUsed: false,
              resourcePools: [{ name: "spellSlot_2", current: 2, max: 2 }],
            },
          },
          {
            combatantType: "Character",
            characterId: counterId,
            initiative: 10,
            hpCurrent: 24,
            hpMax: 24,
            resources: {
              position: { x: 10, y: 0 },
              speed: 30,
              reactionUsed: false,
              hasCounterspellPrepared: true,
              resourcePools: [{ name: "spellSlot_3", current: 2, max: 2 }],
            },
          },
        ],
      },
    });
    const encounterId = (encounter.json() as any).id as string;

    const castRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/action`,
      payload: {
        text: "cast hold person at Counter Mage",
        actorId: casterId,
        encounterId,
      },
    });

    expect(castRes.statusCode).toBe(200);
    const castBody = castRes.json() as any;
    expect(castBody.type).toBe("REACTION_CHECK");
    expect(typeof castBody.pendingActionId).toBe("string");
    expect(Array.isArray(castBody.opportunityAttacks)).toBe(true);
    const counterspellOpp = castBody.opportunityAttacks.find((x: any) => x.canUse === true);
    expect(counterspellOpp).toBeTruthy();
    expect(typeof counterspellOpp.opportunityId).toBe("string");

    const respond = await app.inject({
      method: "POST",
      url: `/encounters/${encounterId}/reactions/${castBody.pendingActionId}/respond`,
      payload: {
        combatantId: counterspellOpp.combatantId,
        opportunityId: counterspellOpp.opportunityId,
        choice: "decline",
      },
    });

    expect(respond.statusCode).toBe(200);
    const respondBody = respond.json() as any;
    expect(respondBody.status).toBe("completed");
    expect(respondBody.spellCastResult).toBeTruthy();
    expect(respondBody.spellCastResult.wasCountered).toBe(false);

    await app.close();
  });

  it("POST /sessions/:id/combat/query returns LLM answer with distance context", async () => {
    const intentParser: IIntentParser = {
      async parseIntent() {
        return {
          answer: "The nearest enemy is Goblin Warrior at 5 feet.",
        };
      },
    };

    const { app } = buildTestApp({ intentParser });

    const createdSession = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { storyFramework: {} },
    });
    const sessionId = (createdSession.json() as any).id as string;

    const char = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: { name: "Mover", level: 1, className: "fighter", sheet: {} },
    });
    const characterId = (char.json() as any).id as string;

    const mon = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/monsters`,
      payload: { name: "Goblin Warrior", statBlock: { hp: 7 } },
    });
    const monsterId = (mon.json() as any).id as string;

    const encounter = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/start`,
      payload: {
        combatants: [
          { combatantType: "Character", characterId, initiative: 20, hpCurrent: 10, hpMax: 10 },
          { combatantType: "Monster", monsterId, initiative: 10, hpCurrent: 7, hpMax: 7 },
        ],
      },
    });
    const encounterId = (encounter.json() as any).id as string;

    const res = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/query`,
      payload: {
        query: "Which goblin is closest to me and how far away?",
        actorId: characterId,
        encounterId,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(typeof body.answer).toBe("string");
    expect(body.answer.length).toBeGreaterThan(0);
    expect(body.context).toBeTruthy();
    expect(Array.isArray(body.context.distances)).toBe(true);
    expect(body.context.distances.length).toBeGreaterThan(0);
    expect(typeof body.context.distances[0].targetId).toBe("string");
    expect(typeof body.context.distances[0].distance).toBe("number");

    await app.close();
  });

  it("POST /sessions/:id/actions endTurn advances turn", async () => {
    const { app } = buildTestApp();

    const createdSession = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { storyFramework: {} },
    });
    const sessionId = (createdSession.json() as any).id as string;

    const char1 = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: { name: "Talia", level: 1, className: "wizard", sheet: {} },
    });
    const characterId1 = (char1.json() as any).id as string;

    const char2 = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: { name: "Borin", level: 1, className: "fighter", sheet: {} },
    });
    const characterId2 = (char2.json() as any).id as string;

    const encounter = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/start`,
      payload: {
        combatants: [
          { combatantType: "Character", characterId: characterId1, initiative: 20, hpCurrent: 10, hpMax: 10 },
          { combatantType: "Character", characterId: characterId2, initiative: 5, hpCurrent: 10, hpMax: 10 },
        ],
      },
    });
    const encounterId = (encounter.json() as any).id as string;

    const next = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/actions`,
      payload: { kind: "endTurn", encounterId, actor: { type: "Character", characterId: characterId1 } },
    });

    expect(next.statusCode).toBe(200);
    const updated = next.json() as any;
    expect(updated.turn).toBe(1);

    await app.close();
  });

  it("POST /sessions/:id/actions endTurn rejects wrong actor", async () => {
    const { app } = buildTestApp();

    const createdSession = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { storyFramework: {} },
    });
    const sessionId = (createdSession.json() as any).id as string;

    const char1 = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: { name: "Talia", level: 1, className: "wizard", sheet: {} },
    });
    const characterId1 = (char1.json() as any).id as string;

    const char2 = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: { name: "Borin", level: 1, className: "fighter", sheet: {} },
    });
    const characterId2 = (char2.json() as any).id as string;

    const encounter = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/start`,
      payload: {
        combatants: [
          { combatantType: "Character", characterId: characterId1, initiative: 20, hpCurrent: 10, hpMax: 10 },
          { combatantType: "Character", characterId: characterId2, initiative: 5, hpCurrent: 10, hpMax: 10 },
        ],
      },
    });
    const encounterId = (encounter.json() as any).id as string;

    // It's characterId1's turn (initiative 20), but characterId2 attempts to end it.
    const res = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/actions`,
      payload: { kind: "endTurn", encounterId, actor: { type: "Character", characterId: characterId2 } },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as any;
    expect(body.error).toBe("ValidationError");

    await app.close();
  });

  it("POST /sessions/:id/actions attack applies damage to target hp", async () => {
    const { app } = buildTestApp();

    const createdSession = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { storyFramework: {} },
    });
    const sessionId = (createdSession.json() as any).id as string;

    const attacker = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: {
        name: "Attacker",
        level: 1,
        className: "fighter",
        sheet: {
          armorClass: 10,
          abilityScores: {
            strength: 16,
            dexterity: 10,
            constitution: 12,
            intelligence: 10,
            wisdom: 10,
            charisma: 10,
          },
        },
      },
    });
    const attackerId = (attacker.json() as any).id as string;

    const target = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: {
        name: "Target",
        level: 1,
        className: "fighter",
        sheet: {
          armorClass: 10,
          abilityScores: {
            strength: 10,
            dexterity: 10,
            constitution: 10,
            intelligence: 10,
            wisdom: 10,
            charisma: 10,
          },
        },
      },
    });
    const targetId = (target.json() as any).id as string;

    const encounter = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/start`,
      payload: {
        combatants: [
          { combatantType: "Character", characterId: attackerId, hpCurrent: 10, hpMax: 10 },
          { combatantType: "Character", characterId: targetId, hpCurrent: 10, hpMax: 10 },
        ],
      },
    });
    const encounterId = (encounter.json() as any).id as string;

    const res = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/actions`,
      payload: {
        kind: "attack",
        encounterId,
        seed: 123,
        attacker: { type: "Character", characterId: attackerId },
        target: { type: "Character", characterId: targetId },
        spec: { kind: "melee", attackBonus: 100, damage: { diceCount: 1, diceSides: 6, modifier: 0 } },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.result).toBeTruthy();
    expect(body.result.hit).toBe(true);
    expect(typeof body.result.damage?.applied).toBe("number");
    expect(body.target.hpCurrent).toBe(10 - body.result.damage.applied);

    await app.close();
  });

  it("POST /sessions/:id/actions attack rejects non-integer seed", async () => {
    const { app } = buildTestApp();

    const createdSession = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { storyFramework: {} },
    });
    const sessionId = (createdSession.json() as any).id as string;

    const attacker = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: {
        name: "Attacker",
        level: 1,
        className: "fighter",
        sheet: {
          armorClass: 10,
          abilityScores: {
            strength: 16,
            dexterity: 10,
            constitution: 12,
            intelligence: 10,
            wisdom: 10,
            charisma: 10,
          },
        },
      },
    });
    const attackerId = (attacker.json() as any).id as string;

    const target = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: {
        name: "Target",
        level: 1,
        className: "fighter",
        sheet: {
          armorClass: 10,
          abilityScores: {
            strength: 10,
            dexterity: 10,
            constitution: 10,
            intelligence: 10,
            wisdom: 10,
            charisma: 10,
          },
        },
      },
    });
    const targetId = (target.json() as any).id as string;

    const encounter = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/start`,
      payload: {
        combatants: [
          { combatantType: "Character", characterId: attackerId, hpCurrent: 10, hpMax: 10 },
          { combatantType: "Character", characterId: targetId, hpCurrent: 10, hpMax: 10 },
        ],
      },
    });
    const encounterId = (encounter.json() as any).id as string;

    const res = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/actions`,
      payload: {
        kind: "attack",
        encounterId,
        seed: 1.5,
        attacker: { type: "Character", characterId: attackerId },
        target: { type: "Character", characterId: targetId },
        spec: { kind: "melee", attackBonus: 100, damage: { diceCount: 1, diceSides: 6, modifier: 0 } },
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as any;
    expect(body.error).toBe("ValidationError");

    await app.close();
  });

  it("POST /sessions/:id/actions attack rejects out-of-turn attacker", async () => {
    const { app } = buildTestApp();

    const createdSession = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { storyFramework: {} },
    });
    const sessionId = (createdSession.json() as any).id as string;

    const attacker = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: {
        name: "Slow",
        level: 1,
        className: "fighter",
        sheet: {
          armorClass: 10,
          abilityScores: {
            strength: 16,
            dexterity: 10,
            constitution: 12,
            intelligence: 10,
            wisdom: 10,
            charisma: 10,
          },
        },
      },
    });
    const attackerId = (attacker.json() as any).id as string;

    const target = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: {
        name: "Fast",
        level: 1,
        className: "fighter",
        sheet: {
          armorClass: 10,
          abilityScores: {
            strength: 10,
            dexterity: 10,
            constitution: 10,
            intelligence: 10,
            wisdom: 10,
            charisma: 10,
          },
        },
      },
    });
    const targetId = (target.json() as any).id as string;

    const encounter = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/start`,
      payload: {
        combatants: [
          { combatantType: "Character", characterId: attackerId, initiative: 5, hpCurrent: 10, hpMax: 10 },
          { combatantType: "Character", characterId: targetId, initiative: 20, hpCurrent: 10, hpMax: 10 },
        ],
      },
    });
    const encounterId = (encounter.json() as any).id as string;

    // Turn starts at 0, which should be the highest initiative (targetId).
    const res = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/actions`,
      payload: {
        kind: "attack",
        encounterId,
        seed: 123,
        attacker: { type: "Character", characterId: attackerId },
        target: { type: "Character", characterId: targetId },
        spec: { kind: "melee", attackBonus: 100, damage: { diceCount: 1, diceSides: 6, modifier: 0 } },
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as any;
    expect(body.error).toBe("ValidationError");

    await app.close();
  });

  it("POST /sessions/:id/actions attack cannot be repeated in same turn", async () => {
    const { app } = buildTestApp();

    const createdSession = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { storyFramework: {} },
    });
    const sessionId = (createdSession.json() as any).id as string;

    const attacker = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: {
        name: "Attacker",
        level: 1,
        className: "fighter",
        sheet: {
          armorClass: 10,
          abilityScores: {
            strength: 16,
            dexterity: 10,
            constitution: 12,
            intelligence: 10,
            wisdom: 10,
            charisma: 10,
          },
        },
      },
    });
    const attackerId = (attacker.json() as any).id as string;

    const target = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: {
        name: "Target",
        level: 1,
        className: "fighter",
        sheet: {
          armorClass: 10,
          abilityScores: {
            strength: 10,
            dexterity: 10,
            constitution: 10,
            intelligence: 10,
            wisdom: 10,
            charisma: 10,
          },
        },
      },
    });
    const targetId = (target.json() as any).id as string;

    const encounter = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/start`,
      payload: {
        combatants: [
          { combatantType: "Character", characterId: attackerId, initiative: 20, hpCurrent: 10, hpMax: 10 },
          { combatantType: "Character", characterId: targetId, initiative: 5, hpCurrent: 10, hpMax: 10 },
        ],
      },
    });
    const encounterId = (encounter.json() as any).id as string;

    const first = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/actions`,
      payload: {
        kind: "attack",
        encounterId,
        seed: 123,
        attacker: { type: "Character", characterId: attackerId },
        target: { type: "Character", characterId: targetId },
        spec: { kind: "melee", attackBonus: 100, damage: { diceCount: 1, diceSides: 6, modifier: 0 } },
      },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/actions`,
      payload: {
        kind: "attack",
        encounterId,
        seed: 123,
        attacker: { type: "Character", characterId: attackerId },
        target: { type: "Character", characterId: targetId },
        spec: { kind: "melee", attackBonus: 100, damage: { diceCount: 1, diceSides: 6, modifier: 0 } },
      },
    });
    expect(second.statusCode).toBe(400);
    const body = second.json() as any;
    expect(body.error).toBe("ValidationError");

    await app.close();
  });

  it("POST /sessions/:id/characters/generate with LLM creates optimized character", async () => {
    const characterGenerator: ICharacterGenerator = {
      async generateCharacter({ className, level }) {
        // Mock LLM response with optimized character sheet
        return {
          hp: 12,
          maxHp: 12,
          armorClass: 16,
          abilityScores: {
            strength: className === "fighter" ? 16 : 10,
            dexterity: className === "wizard" ? 14 : 12,
            constitution: 14,
            intelligence: className === "wizard" ? 16 : 10,
            wisdom: 12,
            charisma: 8,
          },
          background: "Soldier",
          species: className === "wizard" ? "Human" : "Dwarf",
          skills: ["Perception", "Athletics"],
          proficiencies: {
            armor: ["Light armor"],
            weapons: ["Simple weapons"],
            tools: [],
            savingThrows: ["Strength", "Constitution"],
          },
          equipment: [
            { name: "Chain mail", quantity: 1, type: "armor" },
            { name: "Longsword", quantity: 1, type: "weapon" },
            { name: "Shield", quantity: 1, type: "armor" },
          ],
          personality: {
            traits: ["I am brave in the face of danger."],
            ideals: ["Honor: I fight for what is right."],
            bonds: ["I will do anything to protect my comrades."],
            flaws: ["I am too quick to anger."],
          },
        };
      },
    };

    const { app } = buildTestApp({ characterGenerator });

    const sessionRes = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { storyFramework: {} },
    });
    const sessionId = (sessionRes.json() as any).id as string;

    const res = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters/generate`,
      payload: {
        name: "Gimli",
        className: "fighter",
        level: 1,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.name).toBe("Gimli");
    expect(body.className).toBe("fighter");
    expect(body.level).toBe(1);
    expect(body.sheet.species).toBe("Dwarf");
    expect(body.sheet.background).toBe("Soldier");
    expect(body.sheet.abilityScores.strength).toBe(16);
    expect(body.sheet.equipment).toHaveLength(3);
    expect(body.sheet.personality.traits).toHaveLength(1);

    await app.close();
  });

  it("POST /sessions/:id/characters/generate with manual sheet uses provided sheet", async () => {
    const { app } = buildTestApp();

    const sessionRes = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { storyFramework: {} },
    });
    const sessionId = (sessionRes.json() as any).id as string;

    const customSheet = {
      hp: 20,
      maxHp: 20,
      armorClass: 18,
      abilityScores: {
        strength: 18,
        dexterity: 10,
        constitution: 16,
        intelligence: 8,
        wisdom: 12,
        charisma: 14,
      },
      background: "Noble",
      species: "Dragonborn",
      skills: ["Intimidation", "Persuasion"],
    };

    const res = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters/generate`,
      payload: {
        name: "Draxus",
        className: "paladin",
        level: 3,
        sheet: customSheet,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.name).toBe("Draxus");
    expect(body.className).toBe("paladin");
    expect(body.level).toBe(3);
    expect(body.sheet.species).toBe("Dragonborn");
    expect(body.sheet.background).toBe("Noble");
    expect(body.sheet.abilityScores.strength).toBe(18);
    expect(body.sheet.hp).toBe(20);

    await app.close();
  });

  it("POST /sessions/:id/characters/generate returns 400 when missing name", async () => {
    const { app } = buildTestApp();

    const sessionRes = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { storyFramework: {} },
    });
    const sessionId = (sessionRes.json() as any).id as string;

    const res = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters/generate`,
      payload: {
        className: "fighter",
        level: 1,
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as any;
    expect(body.error).toBe("ValidationError");
    expect(body.message).toContain("name");

    await app.close();
  });

  it("POST /sessions/:id/characters/generate returns 400 when missing className", async () => {
    const { app } = buildTestApp();

    const sessionRes = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { storyFramework: {} },
    });
    const sessionId = (sessionRes.json() as any).id as string;

    const res = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters/generate`,
      payload: {
        name: "Testy",
        level: 1,
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as any;
    expect(body.error).toBe("ValidationError");
    expect(body.message).toContain("className");

    await app.close();
  });

  it("POST /sessions/:id/characters/generate returns 400 when no generator available and no sheet provided", async () => {
    const { app } = buildTestApp(); // No characterGenerator provided

    const sessionRes = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { storyFramework: {} },
    });
    const sessionId = (sessionRes.json() as any).id as string;

    const res = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters/generate`,
      payload: {
        name: "NoSheet",
        className: "fighter",
        level: 1,
      },
    });

    expect(res.statusCode).toBe(400);
    const body = res.json() as any;
    expect(body.error).toBe("ValidationError");
    expect(body.message).toContain("character sheet");

    await app.close();
  });

  it("POST /sessions/:id/characters/generate with different classes generates appropriate stats", async () => {
    const characterGenerator: ICharacterGenerator = {
      async generateCharacter({ className }) {
        // Mock different stats for different classes
        const classConfigs: Record<string, any> = {
          wizard: { primaryStat: "intelligence", species: "Elf", background: "Sage" },
          barbarian: { primaryStat: "strength", species: "Half-Orc", background: "Outlander" },
          rogue: { primaryStat: "dexterity", species: "Halfling", background: "Criminal" },
        };

        const config = classConfigs[className] || { primaryStat: "strength", species: "Human", background: "Soldier" };

        return {
          hp: 10,
          maxHp: 10,
          armorClass: 14,
          abilityScores: {
            strength: config.primaryStat === "strength" ? 16 : 10,
            dexterity: config.primaryStat === "dexterity" ? 16 : 10,
            constitution: 12,
            intelligence: config.primaryStat === "intelligence" ? 16 : 10,
            wisdom: 10,
            charisma: 10,
          },
          background: config.background,
          species: config.species,
          skills: ["Perception"],
          proficiencies: {
            armor: [],
            weapons: [],
            tools: [],
            savingThrows: [],
          },
          equipment: [],
          personality: {
            traits: [],
            ideals: [],
            bonds: [],
            flaws: [],
          },
        };
      },
    };

    const { app } = buildTestApp({ characterGenerator });

    const sessionRes = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { storyFramework: {} },
    });
    const sessionId = (sessionRes.json() as any).id as string;

    // Test wizard
    const wizardRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters/generate`,
      payload: { name: "Gandalf", className: "wizard", level: 1 },
    });
    expect(wizardRes.statusCode).toBe(200);
    const wizard = wizardRes.json() as any;
    expect(wizard.sheet.species).toBe("Elf");
    expect(wizard.sheet.background).toBe("Sage");
    expect(wizard.sheet.abilityScores.intelligence).toBe(16);

    // Test barbarian
    const barbarianRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters/generate`,
      payload: { name: "Grog", className: "barbarian", level: 1 },
    });
    expect(barbarianRes.statusCode).toBe(200);
    const barbarian = barbarianRes.json() as any;
    expect(barbarian.sheet.species).toBe("Half-Orc");
    expect(barbarian.sheet.background).toBe("Outlander");
    expect(barbarian.sheet.abilityScores.strength).toBe(16);

    // Test rogue
    const rogueRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters/generate`,
      payload: { name: "Vax", className: "rogue", level: 1 },
    });
    expect(rogueRes.statusCode).toBe(200);
    const rogue = rogueRes.json() as any;
    expect(rogue.sheet.species).toBe("Halfling");
    expect(rogue.sheet.background).toBe("Criminal");
    expect(rogue.sheet.abilityScores.dexterity).toBe(16);

    await app.close();
  });

  it("Flurry of Blows deterministic parsing uses correct monk martial arts die", async () => {
    const { app } = buildTestApp();

    const sessionResp = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { storyFramework: { theme: "Test Flurry combat" } },
    });
    const sessionId = sessionResp.json().id as string;

    // Create level 5 monk (martial arts die = 1d8)
    const charResp = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: {
        name: "Li Wei",
        className: "Monk",
        level: 5,
        sheet: {
          maxHp: 38,
          armorClass: 16,
          speed: 45,
          proficiencyBonus: 3,
          abilityScores: {
            strength: 10,
            dexterity: 16,
            constitution: 14,
            intelligence: 11,
            wisdom: 16,
            charisma: 8,
          },
        },
      },
    });
    const characterId = charResp.json().id as string;

    // Create goblin target
    const monsterResp = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/monsters`,
      payload: {
        name: "Goblin Warrior",
        statBlock: {
          hp: 20,  // Survives first hit
          ac: 15,
          attacks: [
            {
              name: "Scimitar",
              attackBonus: 4,
              damageFormula: "1d6+2",
              damageType: "slashing",
            },
          ],
        },
      },
    });
    const monsterId = monsterResp.json().id as string;

    // Start combat
    const combatResp = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/start`,
      payload: {
        combatants: [
          { 
            combatantType: "Character", 
            characterId, 
            hpCurrent: 38, 
            hpMax: 38, 
            initiative: 18, 
            resources: { 
              resourcePools: [{ name: "ki", current: 5, max: 5 }] 
            } 
          },
          { combatantType: "Monster", monsterId, hpCurrent: 20, hpMax: 20, initiative: 8 },
        ],
      },
    });
    const encounterId = combatResp.json().id as string;

    // Move to melee range
    const tactical = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/combat/${encounterId}/tactical`,
    });
    const goblinPos = tactical.json().combatants.find((c: any) => c.combatantType === "Monster")?.position;

    await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/action`,
      payload: {
        text: `move to (${goblinPos.x}, ${goblinPos.y})`,
        actorId: characterId,
        encounterId,
      },
    });

    // Use Flurry of Blows (should parse deterministically and use 1d8 dice)
    const flurryResp = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/action`,
      payload: {
        text: "use flurry of blows",
        actorId: characterId,
        encounterId,
      },
    });

    if (flurryResp.statusCode !== 200) {
      const body = flurryResp.json();
      console.error("Flurry request failed with status", flurryResp.statusCode);
      console.error("Response body:", JSON.stringify(body, null, 2));
      throw new Error(`Flurry request failed: ${JSON.stringify(body)}`);
    }

    expect(flurryResp.statusCode).toBe(200);
    const flurryResult = flurryResp.json();

    // Should request attack roll for first strike
    expect(flurryResult.type).toBe("REQUEST_ROLL");
    expect(flurryResult.rollType).toBe("attack");

    // Should include target name in message
    expect(flurryResult.message).toContain("Goblin Warrior");

    // Roll first attack (15 + 6 = 21 vs AC 15 → hit)
    const attack1Resp = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/roll-result`,
      payload: {
        text: "I rolled 15",
        actorId: characterId,
      },
    });

    expect(attack1Resp.statusCode).toBe(200);
    const attack1Result = attack1Resp.json();
    expect(attack1Result.hit).toBe(true);
    expect(attack1Result.rollType).toBe("damage");

    // CRITICAL: Damage dice should be 1d8 (martial arts die at level 5, not 1d4 or 1d6)
    // The modifier is applied server-side, diceNeeded shows just the die
    expect(attack1Result.diceNeeded).toMatch(/1d8/);

    // Roll first damage (6 + 3 = 9 damage, 20 - 9 = 11 HP remaining)
    const damage1Resp = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/roll-result`,
      payload: {
        text: "I rolled 6",
        actorId: characterId,
      },
    });

    expect(damage1Resp.statusCode).toBe(200);
    const damage1Result = damage1Resp.json();
    expect(damage1Result.totalDamage).toBe(9);
    expect(damage1Result.targetHpRemaining).toBe(11);

    // Should request SECOND strike automatically
    expect(damage1Result.requiresPlayerInput).toBe(true);
    expect(damage1Result.type).toBe("REQUEST_ROLL");
    expect(damage1Result.rollType).toBe("attack");
    expect(damage1Result.message).toContain("Second strike");

    // Roll second attack (12 + 6 = 18 vs AC 15 → hit)
    const attack2Resp = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/roll-result`,
      payload: {
        text: "I rolled 12",
        actorId: characterId,
      },
    });

    expect(attack2Resp.statusCode).toBe(200);
    const attack2Result = attack2Resp.json();
    expect(attack2Result.hit).toBe(true);

    // Second strike should ALSO use 1d8 (martial arts die)
    expect(attack2Result.diceNeeded).toMatch(/1d8/);

    // Roll second damage (5 + 3 = 8 damage, 11 - 8 = 3 HP remaining)
    const damage2Resp = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/roll-result`,
      payload: {
        text: "I rolled 5",
        actorId: characterId,
      },
    });

    expect(damage2Resp.statusCode).toBe(200);
    const damage2Result = damage2Resp.json();
    expect(damage2Result.totalDamage).toBe(8);
    expect(damage2Result.targetHpRemaining).toBe(3);

    // After second strike completes, action should be complete
    expect(damage2Result.actionComplete).toBe(true);
    expect(damage2Result.requiresPlayerInput).toBe(false);

    await app.close();
  });

  // ── Inventory API tests ──────────────────────────────────────────────

  it("GET /sessions/:id/characters/:charId/inventory returns empty inventory", async () => {
    const { app } = buildTestApp();

    const sessionRes = await app.inject({ method: "POST", url: "/sessions", payload: { storyFramework: {} } });
    const sessionId = (sessionRes.json() as any).id as string;

    const charRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: { name: "Hero", level: 1, className: "fighter", sheet: { maxHp: 10 } },
    });
    const charId = (charRes.json() as any).id as string;

    const res = await app.inject({ method: "GET", url: `/sessions/${sessionId}/characters/${charId}/inventory` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.inventory).toEqual([]);
    expect(body.attunedCount).toBe(0);
    expect(body.maxAttunementSlots).toBe(3);

    await app.close();
  });

  it("POST /sessions/:id/characters/:charId/inventory adds item", async () => {
    const { app } = buildTestApp();

    const sessionRes = await app.inject({ method: "POST", url: "/sessions", payload: { storyFramework: {} } });
    const sessionId = (sessionRes.json() as any).id as string;

    const charRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: { name: "Hero", level: 1, className: "fighter", sheet: { maxHp: 10 } },
    });
    const charId = (charRes.json() as any).id as string;

    const addRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters/${charId}/inventory`,
      payload: { name: "Potion of Healing", quantity: 2 },
    });
    expect(addRes.statusCode).toBe(200);
    const body = addRes.json() as any;
    expect(body.inventory).toHaveLength(1);
    expect(body.inventory[0].name).toBe("Potion of Healing");
    expect(body.inventory[0].quantity).toBe(2);

    await app.close();
  });

  it("POST inventory stacks items with same name", async () => {
    const { app } = buildTestApp();

    const sessionRes = await app.inject({ method: "POST", url: "/sessions", payload: { storyFramework: {} } });
    const sessionId = (sessionRes.json() as any).id as string;

    const charRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: { name: "Hero", level: 1, className: "fighter", sheet: { maxHp: 10 } },
    });
    const charId = (charRes.json() as any).id as string;
    const invUrl = `/sessions/${sessionId}/characters/${charId}/inventory`;

    await app.inject({ method: "POST", url: invUrl, payload: { name: "Potion of Healing", quantity: 1 } });
    const res = await app.inject({ method: "POST", url: invUrl, payload: { name: "Potion of Healing", quantity: 2 } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as any;
    expect(body.inventory).toHaveLength(1);
    expect(body.inventory[0].quantity).toBe(3);

    await app.close();
  });

  it("DELETE /sessions/:id/characters/:charId/inventory/:itemName removes item", async () => {
    const { app } = buildTestApp();

    const sessionRes = await app.inject({ method: "POST", url: "/sessions", payload: { storyFramework: {} } });
    const sessionId = (sessionRes.json() as any).id as string;

    const charRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: { name: "Hero", level: 1, className: "fighter", sheet: { maxHp: 10 } },
    });
    const charId = (charRes.json() as any).id as string;
    const invUrl = `/sessions/${sessionId}/characters/${charId}/inventory`;

    await app.inject({ method: "POST", url: invUrl, payload: { name: "Potion of Healing", quantity: 3 } });

    const delRes = await app.inject({ method: "DELETE", url: `${invUrl}/Potion%20of%20Healing?amount=1` });
    expect(delRes.statusCode).toBe(200);
    const body = delRes.json() as any;
    expect(body.inventory).toHaveLength(1);
    expect(body.inventory[0].quantity).toBe(2);

    await app.close();
  });

  it("PATCH /sessions/:id/characters/:charId/inventory/:itemName equips item", async () => {
    const { app } = buildTestApp();

    const sessionRes = await app.inject({ method: "POST", url: "/sessions", payload: { storyFramework: {} } });
    const sessionId = (sessionRes.json() as any).id as string;

    const charRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: { name: "Hero", level: 1, className: "fighter", sheet: { maxHp: 10 } },
    });
    const charId = (charRes.json() as any).id as string;
    const invUrl = `/sessions/${sessionId}/characters/${charId}/inventory`;

    await app.inject({ method: "POST", url: invUrl, payload: { name: "+1 Longsword", magicItemId: "weapon-plus-1-longsword", quantity: 1 } });

    const patchRes = await app.inject({
      method: "PATCH",
      url: `${invUrl}/%2B1%20Longsword`,
      payload: { equipped: true, attuned: true },
    });
    expect(patchRes.statusCode).toBe(200);
    const body = patchRes.json() as any;
    expect(body.inventory[0].equipped).toBe(true);
    expect(body.inventory[0].attuned).toBe(true);

    await app.close();
  });

  it("inventory attunement respects max 3 slots", async () => {
    const { app } = buildTestApp();

    const sessionRes = await app.inject({ method: "POST", url: "/sessions", payload: { storyFramework: {} } });
    const sessionId = (sessionRes.json() as any).id as string;

    const charRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: { name: "Hero", level: 1, className: "fighter", sheet: { maxHp: 10 } },
    });
    const charId = (charRes.json() as any).id as string;
    const invUrl = `/sessions/${sessionId}/characters/${charId}/inventory`;

    // Add 3 attuned items
    for (let i = 1; i <= 3; i++) {
      await app.inject({ method: "POST", url: invUrl, payload: { name: `Item ${i}`, attuned: true, quantity: 1 } });
    }

    // 4th attuned item should fail
    const res = await app.inject({ method: "POST", url: invUrl, payload: { name: "Item 4", attuned: true, quantity: 1 } });
    expect(res.statusCode).toBe(400);
    const body = res.json() as any;
    expect(body.message).toContain("maximum");

    await app.close();
  });

  it("PATCH inventory equipping armor recalculates sheet AC", async () => {
    const { app } = buildTestApp();

    const sessionRes = await app.inject({ method: "POST", url: "/sessions", payload: { storyFramework: {} } });
    const sessionId = (sessionRes.json() as any).id as string;

    // Create character with 14 DEX (modifier +2) and base AC 10
    const charRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: {
        name: "Knight",
        level: 5,
        className: "fighter",
        sheet: {
          maxHP: 40,
          armorClass: 12,
          abilityScores: { strength: 16, dexterity: 14, constitution: 14, intelligence: 10, wisdom: 10, charisma: 10 },
        },
      },
    });
    const charId = (charRes.json() as any).id as string;
    const invUrl = `/sessions/${sessionId}/characters/${charId}/inventory`;

    // Add +1 Breastplate to inventory (not equipped yet)
    await app.inject({
      method: "POST",
      url: invUrl,
      payload: { name: "+1 Breastplate", slot: "armor", equipped: false, quantity: 1 },
    });

    // Verify current sheet AC is still 12
    let charData = await app.inject({ method: "GET", url: `/sessions/${sessionId}` });
    let session = charData.json() as any;
    let knight = session.characters.find((c: any) => c.name === "Knight");
    expect(knight.sheet.armorClass).toBe(12);

    // Equip the armor via PATCH
    const patchRes = await app.inject({
      method: "PATCH",
      url: `${invUrl}/%2B1%20Breastplate`,
      payload: { equipped: true },
    });
    expect(patchRes.statusCode).toBe(200);

    // Verify sheet AC updated: Breastplate base 14 + 1 magic + 2 DEX (capped at 2) = 17
    charData = await app.inject({ method: "GET", url: `/sessions/${sessionId}` });
    session = charData.json() as any;
    knight = session.characters.find((c: any) => c.name === "Knight");
    expect(knight.sheet.armorClass).toBe(17);
    expect(knight.sheet.equippedArmor).toBeDefined();
    expect(knight.sheet.equippedArmor.name).toBe("+1 Breastplate");
    expect(knight.sheet.equippedArmor.category).toBe("medium");

    // Unequip the armor
    await app.inject({
      method: "PATCH",
      url: `${invUrl}/%2B1%20Breastplate`,
      payload: { equipped: false },
    });

    // Verify AC reverts to unarmored: 10 + 2 DEX = 12
    charData = await app.inject({ method: "GET", url: `/sessions/${sessionId}` });
    session = charData.json() as any;
    knight = session.characters.find((c: any) => c.name === "Knight");
    expect(knight.sheet.armorClass).toBe(12);
    expect(knight.sheet.equippedArmor).toBeUndefined();

    await app.close();
  });
});
