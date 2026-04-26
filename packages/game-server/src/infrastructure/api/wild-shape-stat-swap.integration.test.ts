import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { FixedDiceRoller } from "../../domain/rules/dice-roller.js";
import { buildApp } from "./app.js";
import {
  MemoryCharacterRepository,
  MemoryCombatRepository,
  MemoryEventRepository,
  MemoryGameSessionRepository,
  MemoryMonsterRepository,
  MemoryNPCRepository,
  MemorySpellRepository,
} from "../testing/memory-repos.js";

function buildTestApp(): FastifyInstance {
  return buildApp({
    sessionsRepo: new MemoryGameSessionRepository(),
    charactersRepo: new MemoryCharacterRepository(),
    monstersRepo: new MemoryMonsterRepository(),
    npcsRepo: new MemoryNPCRepository(),
    combatRepo: new MemoryCombatRepository(),
    eventsRepo: new MemoryEventRepository(),
    spellsRepo: new MemorySpellRepository(),
    diceRoller: new FixedDiceRoller(12),
  });
}

describe("Wild Shape stat swap integration", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it("persists wildShapeForm as structured form state and avoids temp HP", async () => {
    app = buildTestApp();

    const sessionRes = await app.inject({
      method: "POST",
      url: "/sessions",
      payload: { storyFramework: {} },
    });
    const sessionId = sessionRes.json().id as string;

    const charRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/characters`,
      payload: {
        name: "Leaf",
        className: "Druid",
        level: 2,
        sheet: {
          className: "druid",
          classId: "druid",
          level: 2,
          maxHP: 18,
          currentHP: 18,
          armorClass: 12,
          speed: 30,
          abilityScores: {
            strength: 10,
            dexterity: 12,
            constitution: 14,
            intelligence: 10,
            wisdom: 16,
            charisma: 10,
          },
        },
      },
    });
    const characterId = charRes.json().id as string;

    const monRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/monsters`,
      payload: {
        name: "Training Goblin",
        statBlock: {
          hp: 10,
          armorClass: 12,
          attacks: [
            {
              name: "Scimitar",
              kind: "melee",
              attackBonus: 4,
              damage: { diceCount: 1, diceSides: 6, modifier: 2 },
              damageType: "slashing",
            },
          ],
        },
      },
    });
    const monsterId = monRes.json().id as string;

    const startRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/start`,
      payload: {
        combatants: [
          {
            combatantType: "Character",
            characterId,
            initiative: 20,
            hpCurrent: 18,
            hpMax: 18,
            resources: {
              resourcePools: [{ name: "wildShape", current: 2, max: 2 }],
            },
          },
          {
            combatantType: "Monster",
            monsterId,
            initiative: 10,
            hpCurrent: 10,
            hpMax: 10,
          },
        ],
      },
    });
    const encounterId = startRes.json().id as string;

    const actionRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/action`,
      payload: {
        text: "wildshape",
        actorId: characterId,
        encounterId,
      },
    });

    expect(actionRes.statusCode, actionRes.body).toBe(200);
    expect(actionRes.json().actionComplete).toBe(true);

    const combatRes = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/combat?encounterId=${encounterId}`,
    });

    const combatants = combatRes.json().combatants as Array<Record<string, unknown>>;
    const druidCombatant = combatants.find((c) => c.characterId === characterId);
    expect(druidCombatant).toBeDefined();

    const resources = (druidCombatant?.resources ?? {}) as Record<string, unknown>;
    expect(typeof resources.wildShapeForm).toBe("object");
    expect(resources.wildShapeForm).not.toBeNull();
    expect(resources.tempHp).toBeUndefined();
  });
});
