/**
 * Integration tests for EM-M2/M3/M4: ASI, Skill Proficiency, Spell Preparation APIs.
 */
import { describe, expect, it, afterEach } from "vitest";
import { buildApp } from "./app.js";
import { FixedDiceRoller } from "../../domain/rules/dice-roller.js";
import {
  MemoryGameSessionRepository,
  MemoryCharacterRepository,
  MemoryMonsterRepository,
  MemoryNPCRepository,
  MemoryCombatRepository,
  MemoryEventRepository,
  MemorySpellRepository,
} from "../testing/memory-repos.js";
import type { FastifyInstance } from "fastify";

function buildTestApp() {
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
  });

  return { app, sessionsRepo, charactersRepo };
}

async function createSessionAndCharacter(
  app: FastifyInstance,
  sheet: Record<string, unknown> = {},
  className = "Fighter",
  level = 5,
) {
  const sessionRes = await app.inject({
    method: "POST",
    url: "/sessions",
    payload: { storyFramework: {} },
  });
  const sessionId = sessionRes.json<{ id: string }>().id;

  const charRes = await app.inject({
    method: "POST",
    url: `/sessions/${sessionId}/characters`,
    payload: {
      name: "TestHero",
      level,
      className,
      sheet: {
        abilityScores: { strength: 16, dexterity: 14, constitution: 12, intelligence: 18, wisdom: 14, charisma: 10 },
        maxHP: 40,
        currentHP: 40,
        armorClass: 15,
        speed: 30,
        classId: className.toLowerCase(),
        ...sheet,
      },
    },
  });
  const charId = charRes.json<{ id: string }>().id;

  return { sessionId, charId };
}

describe("EM-M2/M3/M4 API endpoints", () => {
  describe("PATCH /sessions/:id/characters/:characterId", () => {
    it("applies background pipeline fields on character creation", async () => {
      const { app } = buildTestApp();

      const sessionRes = await app.inject({
        method: "POST",
        url: "/sessions",
        payload: { storyFramework: {} },
      });
      const sessionId = sessionRes.json<{ id: string }>().id;

      const createRes = await app.inject({
        method: "POST",
        url: `/sessions/${sessionId}/characters`,
        payload: {
          name: "Pipeline Hero",
          level: 1,
          className: "Rogue",
          background: "criminal",
          asiChoice: { dexterity: 2, constitution: 1, intelligence: 1 },
          sheet: {
            abilityScores: {
              strength: 10,
              dexterity: 14,
              constitution: 12,
              intelligence: 10,
              wisdom: 10,
              charisma: 10,
            },
            maxHp: 10,
            currentHp: 10,
            armorClass: 14,
            speed: 30,
          },
        },
      });

      expect(createRes.statusCode).toBe(200);
      const created = createRes.json<{ sheet: Record<string, unknown> }>();
      const sheet = created.sheet;

      expect(sheet.background).toBe("criminal");
      expect(sheet.abilityScores).toMatchObject({
        dexterity: 16,
        constitution: 13,
        intelligence: 11,
      });
      expect(sheet.featIds).toEqual(expect.arrayContaining(["feat_alert"]));
      expect(sheet.skillProficiencies).toEqual(expect.arrayContaining(["sleightOfHand", "stealth"]));

      await app.close();
    });

    it("applies valid ASI choices", async () => {
      const { app } = buildTestApp();
      const { sessionId, charId } = await createSessionAndCharacter(app);

      const res = await app.inject({
        method: "PATCH",
        url: `/sessions/${sessionId}/characters/${charId}`,
        payload: {
          asiChoices: [{ level: 4, type: "asi", scores: { strength: 2 } }],
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<{ sheet: Record<string, unknown> }>();
      const sheet = body.sheet as Record<string, unknown>;
      expect(sheet.asiChoices).toEqual([{ level: 4, type: "asi", scores: { strength: 2 } }]);

      await app.close();
    });

    it("rejects ASI at invalid level", async () => {
      const { app } = buildTestApp();
      const { sessionId, charId } = await createSessionAndCharacter(app);

      const res = await app.inject({
        method: "PATCH",
        url: `/sessions/${sessionId}/characters/${charId}`,
        payload: {
          asiChoices: [{ level: 3, type: "asi", scores: { strength: 2 } }],
        },
      });

      expect(res.statusCode).toBe(400);
      await app.close();
    });

    it("applies skill proficiencies", async () => {
      const { app } = buildTestApp();
      const { sessionId, charId } = await createSessionAndCharacter(app);

      const res = await app.inject({
        method: "PATCH",
        url: `/sessions/${sessionId}/characters/${charId}`,
        payload: {
          skillProficiencies: ["athletics", "perception", "stealth"],
        },
      });

      expect(res.statusCode).toBe(200);
      const sheet = (res.json() as any).sheet;
      expect(sheet.skillProficiencies).toEqual(["athletics", "perception", "stealth"]);

      await app.close();
    });

    it("applies skill expertise with validated proficiency", async () => {
      const { app } = buildTestApp();
      const { sessionId, charId } = await createSessionAndCharacter(app);

      const res = await app.inject({
        method: "PATCH",
        url: `/sessions/${sessionId}/characters/${charId}`,
        payload: {
          skillProficiencies: ["stealth", "perception"],
          skillExpertise: ["stealth"],
        },
      });

      expect(res.statusCode).toBe(200);
      const sheet = (res.json() as any).sheet;
      expect(sheet.skillExpertise).toEqual(["stealth"]);

      await app.close();
    });

    it("rejects expertise without proficiency", async () => {
      const { app } = buildTestApp();
      const { sessionId, charId } = await createSessionAndCharacter(app);

      const res = await app.inject({
        method: "PATCH",
        url: `/sessions/${sessionId}/characters/${charId}`,
        payload: {
          skillProficiencies: ["athletics"],
          skillExpertise: ["stealth"],
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toContain("requires proficiency");

      await app.close();
    });

    it("applies prepared spells for wizard", async () => {
      const { app } = buildTestApp();
      const { sessionId, charId } = await createSessionAndCharacter(app, {}, "Wizard");

      const res = await app.inject({
        method: "PATCH",
        url: `/sessions/${sessionId}/characters/${charId}`,
        payload: {
          preparedSpells: ["fireball", "shield", "magic-missile"],
        },
      });

      expect(res.statusCode).toBe(200);
      const sheet = (res.json() as any).sheet;
      expect(sheet.preparedSpells).toEqual(["fireball", "shield", "magic-missile"]);

      await app.close();
    });

    it("rejects too many prepared spells", async () => {
      const { app } = buildTestApp();
      // Wizard level 1, INT 18 (+4), max prepared = 1 + 4 = 5
      const { sessionId, charId } = await createSessionAndCharacter(app, {}, "Wizard", 1);

      const spells = Array.from({ length: 10 }, (_, i) => `spell-${i}`);
      const res = await app.inject({
        method: "PATCH",
        url: `/sessions/${sessionId}/characters/${charId}`,
        payload: { preparedSpells: spells },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toContain("Too many prepared spells");

      await app.close();
    });

    it("applies known spells for warlock", async () => {
      const { app } = buildTestApp();
      const { sessionId, charId } = await createSessionAndCharacter(app, {}, "Warlock");

      const res = await app.inject({
        method: "PATCH",
        url: `/sessions/${sessionId}/characters/${charId}`,
        payload: {
          knownSpells: ["eldritch-blast", "hex"],
        },
      });

      expect(res.statusCode).toBe(200);
      const sheet = (res.json() as any).sheet;
      expect(sheet.knownSpells).toEqual(["eldritch-blast", "hex"]);

      await app.close();
    });

    it("returns 404 for non-existent character", async () => {
      const { app } = buildTestApp();
      const sessionRes = await app.inject({
        method: "POST",
        url: "/sessions",
        payload: { storyFramework: {} },
      });
      const sessionId = sessionRes.json<{ id: string }>().id;

      const res = await app.inject({
        method: "PATCH",
        url: `/sessions/${sessionId}/characters/nonexistent`,
        payload: { skillProficiencies: ["athletics"] },
      });

      expect(res.statusCode).toBe(404);
      await app.close();
    });
  });

  describe("GET /sessions/:id/characters/:characterId/spells", () => {
    it("returns spell info for a wizard", async () => {
      const { app } = buildTestApp();
      const { sessionId, charId } = await createSessionAndCharacter(app, {}, "Wizard");

      const res = await app.inject({
        method: "GET",
        url: `/sessions/${sessionId}/characters/${charId}/spells`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<any>();
      expect(body.casterType).toBe("prepared");
      expect(body.spellcastingAbility).toBe("intelligence");
      // Wizard level 5, INT 18 (+4) → max = 5 + 4 = 9
      expect(body.maxPreparedSpells).toBe(9);
      expect(body.preparedSpells).toEqual([]);

      await app.close();
    });

    it("returns spell info for a warlock (known caster)", async () => {
      const { app } = buildTestApp();
      const { sessionId, charId } = await createSessionAndCharacter(app, {}, "Warlock");

      const res = await app.inject({
        method: "GET",
        url: `/sessions/${sessionId}/characters/${charId}/spells`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<any>();
      expect(body.casterType).toBe("known");
      expect(body.spellcastingAbility).toBe("charisma");
      expect(body.maxPreparedSpells).toBe(0); // Known casters don't prepare

      await app.close();
    });

    it("returns spell info for a fighter (non-caster)", async () => {
      const { app } = buildTestApp();
      const { sessionId, charId } = await createSessionAndCharacter(app, {}, "Fighter");

      const res = await app.inject({
        method: "GET",
        url: `/sessions/${sessionId}/characters/${charId}/spells`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<any>();
      expect(body.casterType).toBe("none");
      expect(body.maxPreparedSpells).toBe(0);

      await app.close();
    });

    it("returns stored prepared spells", async () => {
      const { app } = buildTestApp();
      const { sessionId, charId } = await createSessionAndCharacter(app, {}, "Wizard");

      // Set prepared spells via PATCH
      await app.inject({
        method: "PATCH",
        url: `/sessions/${sessionId}/characters/${charId}`,
        payload: { preparedSpells: ["fireball", "shield"] },
      });

      const res = await app.inject({
        method: "GET",
        url: `/sessions/${sessionId}/characters/${charId}/spells`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json<any>();
      expect(body.preparedSpells).toEqual(["fireball", "shield"]);

      await app.close();
    });
  });
});
