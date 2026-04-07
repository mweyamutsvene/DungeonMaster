import { afterAll, describe, expect, it } from "vitest";
import { nanoid } from "nanoid";

import { buildApp } from "./app.js";
import {
  createPrismaClient,
  PrismaItemDefinitionRepository,
} from "../db/index.js";
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

const prisma = createPrismaClient();

afterAll(async () => {
  await prisma.$disconnect();
});

describe("session inventory custom item lookup", () => {
  it("uses Prisma custom item definitions before static catalog fallback", async () => {
    const customItemId = `test-custom-item-${nanoid(8)}`;
    const customItemName = `Custom Healing Draught ${nanoid(5)}`;

    const itemRepo = new PrismaItemDefinitionRepository(prisma);

    await itemRepo.upsert({
      id: customItemId,
      name: customItemName,
      category: "potion",
      data: {
        id: customItemId,
        name: customItemName,
        category: "potion",
        rarity: "common",
        attunement: { required: false },
        description: "Restores a small amount of HP.",
        potionEffects: {
          healing: { diceCount: 1, diceSides: 4, modifier: 1 },
        },
      },
    });

    const app = buildApp({
      sessionsRepo: new MemoryGameSessionRepository(),
      charactersRepo: new MemoryCharacterRepository(),
      monstersRepo: new MemoryMonsterRepository(),
      npcsRepo: new MemoryNPCRepository(),
      combatRepo: new MemoryCombatRepository(),
      eventsRepo: new MemoryEventRepository(),
      spellsRepo: new MemorySpellRepository(),
      itemDefinitionsRepo: itemRepo,
      diceRoller: new FixedDiceRoller(10),
    });

    try {
      const sessionRes = await app.inject({
        method: "POST",
        url: "/sessions",
        payload: { storyFramework: {} },
      });
      const sessionId = (sessionRes.json() as { id: string }).id;

      const charRes = await app.inject({
        method: "POST",
        url: `/sessions/${sessionId}/characters`,
        payload: {
          name: "CustomPotionTester",
          level: 1,
          className: "fighter",
          sheet: {
            maxHp: 20,
            currentHp: 5,
            inventory: [
              {
                name: customItemName,
                magicItemId: customItemId,
                equipped: false,
                attuned: false,
                quantity: 1,
              },
            ],
          },
        },
      });
      const charId = (charRes.json() as { id: string }).id;

      const useRes = await app.inject({
        method: "POST",
        url: `/sessions/${sessionId}/characters/${charId}/inventory/${encodeURIComponent(customItemName)}/use`,
      });

      expect(useRes.statusCode).toBe(200);
      const body = useRes.json() as {
        used: string;
        hpCurrent: number;
        inventory: Array<{ name: string; quantity: number }>;
      };

      expect(body.used).toBe(customItemName);
      expect(body.hpCurrent).toBe(16);
      expect(body.inventory).toEqual([]);
    } finally {
      await app.close();
      await prisma.itemDefinition.deleteMany({ where: { id: customItemId } });
    }
  });
});
