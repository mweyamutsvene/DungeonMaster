import { describe, expect, it } from "vitest";

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
import { FixedDiceRoller } from "../../domain/rules/dice-roller.js";

function buildTestApp() {
  return buildApp({
    sessionsRepo: new MemoryGameSessionRepository(),
    charactersRepo: new MemoryCharacterRepository(),
    monstersRepo: new MemoryMonsterRepository(),
    npcsRepo: new MemoryNPCRepository(),
    combatRepo: new MemoryCombatRepository(),
    eventsRepo: new MemoryEventRepository(),
    spellsRepo: new MemorySpellRepository(),
    diceRoller: new FixedDiceRoller(10),
  });
}

async function createSessionAndChars(app: Awaited<ReturnType<typeof buildTestApp>>) {
  const sessionRes = await app.inject({
    method: "POST",
    url: "/sessions",
    payload: { storyFramework: {} },
  });
  const sessionId = (sessionRes.json() as { id: string }).id;

  const alice = await app.inject({
    method: "POST",
    url: `/sessions/${sessionId}/characters`,
    payload: {
      name: "Alice",
      level: 1,
      className: "fighter",
      sheet: {
        maxHp: 20,
        currentHp: 20,
        inventory: [
          {
            name: "Potion of Healing",
            quantity: 3,
            equipped: false,
            attuned: false,
          },
        ],
      },
    },
  });
  const aliceId = (alice.json() as { id: string }).id;

  const bob = await app.inject({
    method: "POST",
    url: `/sessions/${sessionId}/characters`,
    payload: {
      name: "Bob",
      level: 1,
      className: "fighter",
      sheet: { maxHp: 20, currentHp: 20, inventory: [] },
    },
  });
  const bobId = (bob.json() as { id: string }).id;

  return { sessionId, aliceId, bobId };
}

describe("POST /sessions/:id/characters/:charId/inventory/:itemName/transfer", () => {
  it("moves a stack from one character to another", async () => {
    const app = buildTestApp();
    try {
      const { sessionId, aliceId, bobId } = await createSessionAndChars(app);

      const res = await app.inject({
        method: "POST",
        url: `/sessions/${sessionId}/characters/${aliceId}/inventory/${encodeURIComponent("Potion of Healing")}/transfer`,
        payload: { toCharId: bobId, quantity: 2 },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        itemName: string;
        quantity: number;
        fromInventory: Array<{ name: string; quantity: number }>;
        toInventory: Array<{ name: string; quantity: number }>;
      };
      expect(body.itemName).toBe("Potion of Healing");
      expect(body.quantity).toBe(2);
      expect(body.fromInventory[0].quantity).toBe(1);
      expect(body.toInventory[0].quantity).toBe(2);
    } finally {
      await app.close();
    }
  });

  it("returns 400 when source does not have the item", async () => {
    const app = buildTestApp();
    try {
      const { sessionId, aliceId, bobId } = await createSessionAndChars(app);

      const res = await app.inject({
        method: "POST",
        url: `/sessions/${sessionId}/characters/${aliceId}/inventory/${encodeURIComponent("Bogus Item")}/transfer`,
        payload: { toCharId: bobId, quantity: 1 },
      });

      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("returns 400 when toCharId is missing", async () => {
    const app = buildTestApp();
    try {
      const { sessionId, aliceId } = await createSessionAndChars(app);

      const res = await app.inject({
        method: "POST",
        url: `/sessions/${sessionId}/characters/${aliceId}/inventory/${encodeURIComponent("Potion of Healing")}/transfer`,
        payload: { quantity: 1 },
      });

      expect(res.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it("returns 404 when destination character does not exist", async () => {
    const app = buildTestApp();
    try {
      const { sessionId, aliceId } = await createSessionAndChars(app);

      const res = await app.inject({
        method: "POST",
        url: `/sessions/${sessionId}/characters/${aliceId}/inventory/${encodeURIComponent("Potion of Healing")}/transfer`,
        payload: { toCharId: "nonexistent", quantity: 1 },
      });

      expect(res.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
