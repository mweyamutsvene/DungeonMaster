/**
 * Unit tests for:
 * 1. Combat end conditions — flee status, manual combat end (dm_end)
 * 2. Help action — creates consumable advantage ActiveEffect
 *
 * Uses buildApp + app.inject() with in-memory repositories.
 */

import { describe, it, expect, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../../infrastructure/api/app.js";
import { FixedDiceRoller } from "../../../domain/rules/dice-roller.js";
import {
  MemoryGameSessionRepository,
  MemoryCharacterRepository,
  MemoryMonsterRepository,
  MemoryCombatRepository,
  MemoryEventRepository,
  MemoryNPCRepository,
  MemorySpellRepository,
} from "../../../infrastructure/testing/memory-repos.js";
import { BasicCombatVictoryPolicy, hasFled } from "./combat-victory-policy.js";
import type { CombatantStateRecord } from "../../types.js";
import { getActiveEffects } from "./helpers/resource-utils.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildTestApp(fixedDie = 10): FastifyInstance {
  return buildApp({
    sessionsRepo: new MemoryGameSessionRepository(),
    charactersRepo: new MemoryCharacterRepository(),
    monstersRepo: new MemoryMonsterRepository(),
    npcsRepo: new MemoryNPCRepository(),
    combatRepo: new MemoryCombatRepository(),
    eventsRepo: new MemoryEventRepository(),
    spellsRepo: new MemorySpellRepository(),
    diceRoller: new FixedDiceRoller(fixedDie),
  });
}

async function createSession(app: FastifyInstance): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/sessions",
    payload: { storyFramework: {} },
  });
  return JSON.parse(res.body).id;
}

async function addCharacter(
  app: FastifyInstance,
  sessionId: string,
  overrides?: Record<string, unknown>,
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: `/sessions/${sessionId}/characters`,
    payload: {
      name: "TestHero",
      level: 5,
      className: "fighter",
      sheet: {
        race: "Human",
        abilityScores: { strength: 16, dexterity: 14, constitution: 14, intelligence: 10, wisdom: 12, charisma: 8 },
        hp: 40,
        armorClass: 18,
      },
      ...overrides,
    },
  });
  return JSON.parse(res.body).id;
}

async function addMonster(
  app: FastifyInstance,
  sessionId: string,
  overrides?: Record<string, unknown>,
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: `/sessions/${sessionId}/monsters`,
    payload: {
      name: "Goblin",
      statBlock: {
        hp: 7,
        armorClass: 15,
        speed: 30,
        abilityScores: { strength: 8, dexterity: 14, constitution: 10, intelligence: 10, wisdom: 8, charisma: 8 },
        attacks: [{ name: "Scimitar", kind: "melee", attackBonus: 4, damage: { diceCount: 1, diceSides: 6, modifier: 2 }, damageType: "slashing" }],
        faction: "enemy",
      },
      ...overrides,
    },
  });
  return JSON.parse(res.body).id;
}

async function startCombat(
  app: FastifyInstance,
  sessionId: string,
  charId: string,
  monId: string,
  charHp = 40,
  monHp = 7,
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: `/sessions/${sessionId}/combat/start`,
    payload: {
      combatants: [
        { combatantType: "Character", characterId: charId, initiative: 20, hpCurrent: charHp, hpMax: charHp },
        { combatantType: "Monster", monsterId: monId, initiative: 10, hpCurrent: monHp, hpMax: monHp },
      ],
    },
  });
  return JSON.parse(res.body).id;
}

// ─── hasFled helper ──────────────────────────────────────────────────────────

describe("hasFled", () => {
  it("returns false when combatant has not fled", () => {
    const combatant = { resources: {} } as CombatantStateRecord;
    expect(hasFled(combatant)).toBe(false);
  });

  it("returns true when combatant has fled: true in resources", () => {
    const combatant = { resources: { fled: true } } as CombatantStateRecord;
    expect(hasFled(combatant)).toBe(true);
  });

  it("returns false when resources is null", () => {
    const combatant = { resources: null } as CombatantStateRecord;
    expect(hasFled(combatant)).toBe(false);
  });
});

// ─── Victory Policy with fled combatants ─────────────────────────────────────

describe("BasicCombatVictoryPolicy with fled status", () => {
  it("returns Victory when all enemies are fled (even if alive)", async () => {
    const mockFactionService = {
      getFactions: async (cbs: CombatantStateRecord[]) => {
        const m = new Map<string, string>();
        for (const c of cbs) {
          if (c.combatantType === "Character") m.set(c.id, "party");
          else m.set(c.id, "enemy");
        }
        return m;
      },
    };

    const policy = new BasicCombatVictoryPolicy(mockFactionService as any);

    // Combatants: one party member alive, one enemy alive but fled
    const combatants: CombatantStateRecord[] = [
      {
        id: "char-1",
        combatantType: "Character",
        characterId: "hero",
        monsterId: null,
        npcId: null,
        initiative: 20,
        hpCurrent: 40,
        hpMax: 40,
        conditions: [],
        resources: { position: { x: 10, y: 10 }, speed: 30 },
      } as CombatantStateRecord,
      {
        id: "mon-1",
        combatantType: "Monster",
        characterId: null,
        monsterId: "goblin",
        npcId: null,
        initiative: 10,
        hpCurrent: 7,
        hpMax: 7,
        conditions: [],
        resources: { position: { x: 40, y: 10 }, speed: 30, fled: true },
      } as CombatantStateRecord,
    ];

    const result = await policy.evaluate({ combatants });
    expect(result).toBe("Victory");
  });

  it("returns null when enemies are alive and not fled", async () => {
    const mockFactionService = {
      getFactions: async (cbs: CombatantStateRecord[]) => {
        const m = new Map<string, string>();
        for (const c of cbs) {
          if (c.combatantType === "Character") m.set(c.id, "party");
          else m.set(c.id, "enemy");
        }
        return m;
      },
    };

    const policy = new BasicCombatVictoryPolicy(mockFactionService as any);

    const combatants: CombatantStateRecord[] = [
      {
        id: "char-1",
        combatantType: "Character",
        characterId: "hero",
        monsterId: null,
        npcId: null,
        initiative: 20,
        hpCurrent: 40,
        hpMax: 40,
        conditions: [],
        resources: {},
      } as CombatantStateRecord,
      {
        id: "mon-1",
        combatantType: "Monster",
        characterId: null,
        monsterId: "goblin",
        npcId: null,
        initiative: 10,
        hpCurrent: 7,
        hpMax: 7,
        conditions: [],
        resources: {},
      } as CombatantStateRecord,
    ];

    const result = await policy.evaluate({ combatants });
    expect(result).toBeNull();
  });
});

// ─── Manual combat end (POST /sessions/:id/combat/end) ──────────────────────

describe("POST /sessions/:id/combat/end", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  it("ends combat with dm_end reason", async () => {
    app = buildTestApp();
    const sessionId = await createSession(app);
    const charId = await addCharacter(app, sessionId);
    const monId = await addMonster(app, sessionId);
    const encounterId = await startCombat(app, sessionId, charId, monId);

    const endRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/end`,
      payload: { encounterId, reason: "dm_end" },
    });
    expect(endRes.statusCode).toBe(200);
    const body = JSON.parse(endRes.body);
    expect(body.status).toBe("Victory");
  });

  it("ends combat with surrender reason and custom result", async () => {
    app = buildTestApp();
    const sessionId = await createSession(app);
    const charId = await addCharacter(app, sessionId);
    const monId = await addMonster(app, sessionId);
    const encounterId = await startCombat(app, sessionId, charId, monId);

    const endRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/end`,
      payload: { encounterId, reason: "surrender", result: "Draw" },
    });
    expect(endRes.statusCode).toBe(200);
    const body = JSON.parse(endRes.body);
    expect(body.status).toBe("Draw");
  });

  it("ends combat with flee reason", async () => {
    app = buildTestApp();
    const sessionId = await createSession(app);
    const charId = await addCharacter(app, sessionId);
    const monId = await addMonster(app, sessionId);
    const encounterId = await startCombat(app, sessionId, charId, monId);

    const endRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/end`,
      payload: { encounterId, reason: "flee" },
    });
    expect(endRes.statusCode).toBe(200);
    const body = JSON.parse(endRes.body);
    expect(body.status).toBe("Victory");
  });

  it("rejects invalid reason", async () => {
    app = buildTestApp();
    const sessionId = await createSession(app);
    const charId = await addCharacter(app, sessionId);
    const monId = await addMonster(app, sessionId);
    const encounterId = await startCombat(app, sessionId, charId, monId);

    const endRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/end`,
      payload: { encounterId, reason: "invalid" },
    });
    expect(endRes.statusCode).toBe(400);
  });

  it("rejects ending already-ended combat", async () => {
    app = buildTestApp();
    const sessionId = await createSession(app);
    const charId = await addCharacter(app, sessionId);
    const monId = await addMonster(app, sessionId);
    const encounterId = await startCombat(app, sessionId, charId, monId);

    // End combat first
    await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/end`,
      payload: { encounterId, reason: "dm_end" },
    });

    // Try to end it again
    const endRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/end`,
      payload: { encounterId, reason: "dm_end" },
    });
    expect(endRes.statusCode).toBe(400);
  });

  it("emits CombatEnded event with reason", async () => {
    app = buildTestApp();
    const sessionId = await createSession(app);
    const charId = await addCharacter(app, sessionId);
    const monId = await addMonster(app, sessionId);
    const encounterId = await startCombat(app, sessionId, charId, monId);

    await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/end`,
      payload: { encounterId, reason: "surrender", result: "Defeat" },
    });

    // Check events
    const eventsRes = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/events-json`,
    });
    const events = JSON.parse(eventsRes.body);
    const combatEndedEvent = events.find((e: any) => e.type === "CombatEnded");
    expect(combatEndedEvent).toBeTruthy();
    expect(combatEndedEvent.payload.reason).toBe("surrender");
    expect(combatEndedEvent.payload.result).toBe("Defeat");
  });
});

// ─── Help action creates consumable advantage ActiveEffect ───────────────────

describe("Help action creates advantage ActiveEffect", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app?.close();
  });

  it("creates advantage effect on target when help is used", async () => {
    app = buildTestApp();
    const sessionId = await createSession(app);
    const charId = await addCharacter(app, sessionId, { name: "Helper" });
    const monId = await addMonster(app, sessionId);

    // Start combat
    const combatRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/start`,
      payload: {
        combatants: [
          { combatantType: "Character", characterId: charId, initiative: 20, hpCurrent: 40, hpMax: 40 },
          { combatantType: "Monster", monsterId: monId, initiative: 10, hpCurrent: 7, hpMax: 7 },
        ],
      },
    });
    if (combatRes.statusCode !== 200) {
      throw new Error(`Start combat failed (${combatRes.statusCode}): ${combatRes.body}`);
    }
    const encounterId = JSON.parse(combatRes.body).id;

    // Use the programmatic help action via the API
    const helpRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/actions`,
      payload: {
        kind: "help",
        encounterId,
        actor: { type: "Character", characterId: charId },
        target: { type: "Monster", monsterId: monId },
      },
    });
    if (helpRes.statusCode !== 200) {
      throw new Error(`Help response (${helpRes.statusCode}): ${helpRes.body}`);
    }
    expect(helpRes.statusCode).toBe(200);

    // Check that the monster now has an advantage ActiveEffect
    const combatantsRes = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/combat/${encounterId}/combatants`,
    });
    const combatants: CombatantStateRecord[] = JSON.parse(combatantsRes.body);
    const monster = combatants.find((c) => c.monsterId === monId)!;

    const effects = getActiveEffects(monster.resources);
    const helpEffect = effects.find((e) => e.source === "Help");
    expect(helpEffect).toBeTruthy();
    expect(helpEffect!.type).toBe("advantage");
    expect(helpEffect!.target).toBe("attack_rolls");
    expect(helpEffect!.duration).toBe("until_triggered");
    expect(helpEffect!.targetCombatantId).toBe(monId);
  });
});
