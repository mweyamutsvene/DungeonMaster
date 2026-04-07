import { describe, expect, it } from "vitest";

import { MemoryItemDefinitionRepository } from "./memory-repos.js";

describe("MemoryItemDefinitionRepository", () => {
  it("supports upsert and lookup by id/name", async () => {
    const repo = new MemoryItemDefinitionRepository();

    await repo.upsert({
      id: "custom-potion",
      name: "Custom Potion",
      category: "potion",
      data: {
        id: "custom-potion",
        name: "Custom Potion",
        category: "potion",
        rarity: "common",
        attunement: { required: false },
        description: "Homebrew healing potion.",
        potionEffects: { healing: { diceCount: 1, diceSides: 4, modifier: 1 } },
      },
    });

    const byId = await repo.findById("custom-potion");
    const byName = await repo.findByName("Custom Potion");
    const all = await repo.listAll();

    expect(byId?.id).toBe("custom-potion");
    expect(byName?.name).toBe("Custom Potion");
    expect(all).toHaveLength(1);
  });

  it("updates existing records on upsert", async () => {
    const repo = new MemoryItemDefinitionRepository();

    const created = await repo.upsert({
      id: "homebrew-ring",
      name: "Ring of Sparks",
      category: "wondrous-item",
      data: { id: "homebrew-ring", name: "Ring of Sparks" },
    });

    const updated = await repo.upsert({
      id: "homebrew-ring",
      name: "Ring of Embers",
      category: "wondrous-item",
      data: { id: "homebrew-ring", name: "Ring of Embers" },
    });

    expect(updated.createdAt.getTime()).toBe(created.createdAt.getTime());
    expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());

    const current = await repo.findById("homebrew-ring");
    expect(current?.name).toBe("Ring of Embers");
  });
});
