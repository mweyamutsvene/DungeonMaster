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
}

class MemoryCombatRepository implements ICombatRepository {
  private readonly encounters = new Map<string, CombatEncounterRecord>();
  private readonly combatantsByEncounter = new Map<string, CombatantStateRecord[]>();
  private readonly pendingActionsByEncounter = new Map<string, JsonValue>();

  async createEncounter(
    sessionId: string,
    input: { id: string; status: string; round: number; turn: number },
  ): Promise<CombatEncounterRecord> {
    const created: CombatEncounterRecord = {
      id: input.id,
      sessionId,
      status: input.status,
      round: input.round,
      turn: input.turn,
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
    patch: Partial<Pick<CombatEncounterRecord, "status" | "round" | "turn">>,
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
    patch: Partial<Pick<CombatantStateRecord, "hpCurrent" | "hpMax" | "initiative" | "conditions" | "resources">>,
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
});
