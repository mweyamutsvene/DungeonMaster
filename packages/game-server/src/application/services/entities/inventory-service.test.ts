import { describe, it, expect, beforeEach } from "vitest";
import { nanoid } from "nanoid";

import { InventoryService } from "./inventory-service.js";
import {
  MemoryCharacterRepository,
  MemoryEventRepository,
} from "../../../infrastructure/testing/memory-repos.js";
import { ConflictError, NotFoundError, ValidationError } from "../../errors.js";
import type { CharacterItemInstance } from "../../../domain/entities/items/magic-item.js";
import type { StructuredMaterialComponent } from "../../../domain/entities/spells/catalog/types.js";

const SESSION = "session-1";

function berry(quantity = 1, longRestsRemaining = 1): CharacterItemInstance {
  return {
    id: nanoid(),
    name: "Goodberry",
    magicItemId: "goodberry-berry",
    quantity,
    longRestsRemaining,
  };
}

function sword(quantity = 1, extra: Partial<CharacterItemInstance> = {}): CharacterItemInstance {
  return {
    id: nanoid(),
    name: "Longsword",
    quantity,
    ...extra,
  };
}

async function createCharacter(
  repo: MemoryCharacterRepository,
  id: string,
  name: string,
  inventory: CharacterItemInstance[] = [],
) {
  return repo.createInSession(SESSION, {
    id,
    name,
    level: 1,
    className: "Fighter",
    sheet: { inventory },
  });
}

function buildService(): {
  service: InventoryService;
  chars: MemoryCharacterRepository;
  events: MemoryEventRepository;
} {
  const chars = new MemoryCharacterRepository();
  const events = new MemoryEventRepository();
  const service = new InventoryService({
    charactersRepo: chars,
    events,
    logger: { warn: () => {} },
  });
  return { service, chars, events };
}

describe("InventoryService.transferItem", () => {
  let service: InventoryService;
  let chars: MemoryCharacterRepository;
  let events: MemoryEventRepository;

  beforeEach(() => {
    ({ service, chars, events } = buildService());
  });

  it("moves one stack from source to destination and emits paired events", async () => {
    await createCharacter(chars, "alice", "Alice", [sword(1)]);
    await createCharacter(chars, "bob", "Bob", []);

    const result = await service.transferItem(SESSION, "alice", "bob", "Longsword", 1);

    expect(result.quantity).toBe(1);
    expect(result.fromInventory).toHaveLength(0);
    expect(result.toInventory).toHaveLength(1);
    expect(result.toInventory[0].name).toBe("Longsword");

    const alice = await chars.getById("alice");
    const bob = await chars.getById("bob");
    expect((alice!.sheet as any).inventory).toHaveLength(0);
    expect((bob!.sheet as any).inventory).toHaveLength(1);

    const emitted = events.getAll().filter((e) => e.type === "InventoryChanged");
    expect(emitted).toHaveLength(2);
    const actions = emitted.map((e) => (e.payload as any).action).sort();
    expect(actions).toEqual(["transfer-in", "transfer-out"]);
  });

  it("transfers partial stack quantity and leaves remainder on source", async () => {
    await createCharacter(chars, "alice", "Alice", [berry(10, 1)]);
    await createCharacter(chars, "bob", "Bob", []);

    const result = await service.transferItem(SESSION, "alice", "bob", "Goodberry", 3);

    expect(result.quantity).toBe(3);
    expect(result.fromInventory[0].quantity).toBe(7);
    expect(result.toInventory[0].quantity).toBe(3);
    // Moved stack preserves longRestsRemaining (so it still expires on recipient's next long rest)
    expect(result.toInventory[0].longRestsRemaining).toBe(1);
  });

  it("rejects transfer when source does not have the item", async () => {
    await createCharacter(chars, "alice", "Alice", []);
    await createCharacter(chars, "bob", "Bob", []);

    await expect(
      service.transferItem(SESSION, "alice", "bob", "Longsword", 1),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects transfer when source has insufficient quantity", async () => {
    await createCharacter(chars, "alice", "Alice", [berry(2, 1)]);
    await createCharacter(chars, "bob", "Bob", []);

    await expect(
      service.transferItem(SESSION, "alice", "bob", "Goodberry", 5),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects transfer of attuned items", async () => {
    await createCharacter(chars, "alice", "Alice", [
      sword(1, { attuned: true, requiresAttunement: true }),
    ]);
    await createCharacter(chars, "bob", "Bob", []);

    await expect(
      service.transferItem(SESSION, "alice", "bob", "Longsword", 1),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects transfer to the same character", async () => {
    await createCharacter(chars, "alice", "Alice", [sword(1)]);

    await expect(
      service.transferItem(SESSION, "alice", "alice", "Longsword", 1),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws NotFoundError when source character does not exist", async () => {
    await createCharacter(chars, "bob", "Bob", []);

    await expect(
      service.transferItem(SESSION, "ghost", "bob", "Longsword", 1),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("retries once on ConflictError and surfaces after second conflict", async () => {
    await createCharacter(chars, "alice", "Alice", [sword(1)]);
    await createCharacter(chars, "bob", "Bob", []);

    // Monkey-patch updateSheetWithVersion to always throw ConflictError for Alice.
    const original = chars.updateSheetWithVersion.bind(chars);
    let calls = 0;
    chars.updateSheetWithVersion = async (id, sheet, version) => {
      calls++;
      if (id === "alice") {
        throw new ConflictError(`Simulated conflict ${calls}`);
      }
      return original(id, sheet, version);
    };

    await expect(
      service.transferItem(SESSION, "alice", "bob", "Longsword", 1),
    ).rejects.toBeInstanceOf(ConflictError);
    // Ensures we retried once (at least 2 calls on alice).
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});

describe("InventoryService.sweepExpiredItems", () => {
  it("prunes items with longRestsRemaining === 0 and emits expire events", async () => {
    const { service, chars, events } = buildService();
    await createCharacter(chars, "alice", "Alice", [
      berry(10, 0), // expired
      sword(1), // permanent, untouched
    ]);

    const result = await service.sweepExpiredItems(SESSION, ["alice"]);

    expect(result.totalStacksPruned).toBe(1);
    expect(result.expiredByCharacter["alice"]).toHaveLength(1);
    expect(result.expiredByCharacter["alice"][0].name).toBe("Goodberry");

    const updated = await chars.getById("alice");
    expect((updated!.sheet as any).inventory).toHaveLength(1);
    expect((updated!.sheet as any).inventory[0].name).toBe("Longsword");

    const expireEvents = events.getAll().filter((e) => e.type === "InventoryChanged");
    expect(expireEvents).toHaveLength(1);
    expect((expireEvents[0].payload as any).action).toBe("expire");
  });

  it("leaves non-expired stacks untouched and does not write when nothing changes", async () => {
    const { service, chars } = buildService();
    const beforeVer = (await createCharacter(chars, "alice", "Alice", [
      berry(10, 1), // still valid
      sword(1),
    ])).sheetVersion;

    const result = await service.sweepExpiredItems(SESSION, ["alice"]);

    expect(result.totalStacksPruned).toBe(0);
    const after = await chars.getById("alice");
    // No write → version unchanged.
    expect(after!.sheetVersion).toBe(beforeVer);
  });

  it("handles empty character list without error", async () => {
    const { service } = buildService();
    const result = await service.sweepExpiredItems(SESSION, []);
    expect(result.totalStacksPruned).toBe(0);
    expect(result.expiredByCharacter).toEqual({});
  });
});

describe("InventoryService.applyLongRestToInventory", () => {
  it("decrements longRestsRemaining and prunes stacks that reach 0", async () => {
    const { service, chars } = buildService();
    await createCharacter(chars, "alice", "Alice", [
      berry(10, 1), // will expire this rest
      berry(5, 2), // decrements to 1
      sword(1), // untouched
    ]);

    const result = await service.applyLongRestToInventory(SESSION, ["alice"]);

    expect(result.totalStacksPruned).toBe(1);
    const after = await chars.getById("alice");
    const inv = (after!.sheet as any).inventory as CharacterItemInstance[];
    expect(inv).toHaveLength(2);
    const surviving = inv.find((i) => i.longRestsRemaining !== undefined);
    expect(surviving?.longRestsRemaining).toBe(1);
    expect(inv.some((i) => i.name === "Longsword")).toBe(true);
  });
});

describe("InventoryService.createItemsForCharacter", () => {
  it("appends items to the character's inventory and emits create events", async () => {
    const { service, chars, events } = buildService();
    await createCharacter(chars, "alice", "Alice", []);

    await service.createItemsForCharacter(SESSION, "alice", [berry(10, 1)]);

    const after = await chars.getById("alice");
    const inv = (after!.sheet as any).inventory as CharacterItemInstance[];
    expect(inv).toHaveLength(1);
    expect(inv[0].quantity).toBe(10);

    const createEvents = events
      .getAll()
      .filter((e) => e.type === "InventoryChanged" && (e.payload as any).action === "create");
    expect(createEvents).toHaveLength(1);
  });

  it("stack-merges identical items already on the sheet", async () => {
    const { service, chars } = buildService();
    await createCharacter(chars, "alice", "Alice", [berry(3, 1)]);

    await service.createItemsForCharacter(SESSION, "alice", [berry(7, 1)]);

    const after = await chars.getById("alice");
    const inv = (after!.sheet as any).inventory as CharacterItemInstance[];
    expect(inv).toHaveLength(1);
    expect(inv[0].quantity).toBe(10);
  });

  it("does not merge stacks with different longRestsRemaining", async () => {
    const { service, chars } = buildService();
    await createCharacter(chars, "alice", "Alice", [berry(10, 1)]);

    await service.createItemsForCharacter(SESSION, "alice", [berry(10, 2)]);

    const after = await chars.getById("alice");
    const inv = (after!.sheet as any).inventory as CharacterItemInstance[];
    expect(inv).toHaveLength(2);
  });

  it("is a no-op for empty items array", async () => {
    const { service, chars } = buildService();
    const created = await createCharacter(chars, "alice", "Alice", []);

    await service.createItemsForCharacter(SESSION, "alice", []);

    const after = await chars.getById("alice");
    expect(after!.sheetVersion).toBe(created.sheetVersion);
  });
});

// ─── Material component helpers ────────────────────────────────────────────

function gem(name: string, valueGp: number, quantity = 1): CharacterItemInstance {
  return { name, quantity, valueGp } as unknown as CharacterItemInstance;
}

const DIAMOND_300: StructuredMaterialComponent = {
  description: "a diamond worth 300+ GP, consumed",
  itemKeyword: "diamond",
  costGp: 300,
  consumed: true,
};

const DIAMOND_50: StructuredMaterialComponent = {
  description: "a diamond worth 50+ GP",
  itemKeyword: "diamond",
  costGp: 50,
  consumed: false,
};

describe("InventoryService.findItemMatchingComponent", () => {
  it("finds item matching keyword and sufficient value", async () => {
    const { service, chars } = buildService();
    await createCharacter(chars, "alice", "Alice", [gem("Diamond", 300)]);

    const result = await service.findItemMatchingComponent(SESSION, "alice", DIAMOND_300);

    expect(result.found).toBe(true);
    expect(result.itemName).toBe("Diamond");
  });

  it("returns found=false when no item matches keyword", async () => {
    const { service, chars } = buildService();
    await createCharacter(chars, "alice", "Alice", [gem("Ruby", 500)]);

    const result = await service.findItemMatchingComponent(SESSION, "alice", DIAMOND_300);

    expect(result.found).toBe(false);
  });

  it("returns found=false when item value is below costGp", async () => {
    const { service, chars } = buildService();
    await createCharacter(chars, "alice", "Alice", [gem("Diamond", 100)]);

    const result = await service.findItemMatchingComponent(SESSION, "alice", DIAMOND_300);

    expect(result.found).toBe(false);
  });

  it("returns found=false when inventory is empty", async () => {
    const { service, chars } = buildService();
    await createCharacter(chars, "alice", "Alice", []);

    const result = await service.findItemMatchingComponent(SESSION, "alice", DIAMOND_300);

    expect(result.found).toBe(false);
  });

  it("returns found=false when character not in session", async () => {
    const { service } = buildService();

    const result = await service.findItemMatchingComponent(SESSION, "ghost", DIAMOND_300);

    expect(result.found).toBe(false);
  });

  it("matches case-insensitively on item name", async () => {
    const { service, chars } = buildService();
    await createCharacter(chars, "alice", "Alice", [gem("flawless diamond", 300)]);

    const result = await service.findItemMatchingComponent(SESSION, "alice", DIAMOND_300);

    expect(result.found).toBe(true);
  });
});

describe("InventoryService.consumeMaterialComponent", () => {
  it("removes item from inventory when quantity is 1", async () => {
    const { service, chars } = buildService();
    await createCharacter(chars, "alice", "Alice", [gem("Diamond", 300)]);

    await service.consumeMaterialComponent(SESSION, "alice", DIAMOND_300);

    const after = await chars.getById("alice");
    expect((after!.sheet as any).inventory).toHaveLength(0);
  });

  it("decrements quantity by 1 when stack > 1", async () => {
    const { service, chars } = buildService();
    await createCharacter(chars, "alice", "Alice", [gem("Diamond", 300, 3)]);

    await service.consumeMaterialComponent(SESSION, "alice", DIAMOND_300);

    const after = await chars.getById("alice");
    const inv = (after!.sheet as any).inventory as CharacterItemInstance[];
    expect(inv).toHaveLength(1);
    expect(inv[0].quantity).toBe(2);
  });

  it("emits InventoryChanged use event", async () => {
    const { service, chars, events } = buildService();
    await createCharacter(chars, "alice", "Alice", [gem("Diamond", 300)]);

    await service.consumeMaterialComponent(SESSION, "alice", DIAMOND_300);

    const changed = events.getAll().filter((e) => e.type === "InventoryChanged");
    expect(changed).toHaveLength(1);
    expect((changed[0].payload as any).action).toBe("use");
    expect((changed[0].payload as any).itemName).toBe("Diamond");
  });

  it("throws ValidationError when matching item not found", async () => {
    const { service, chars } = buildService();
    await createCharacter(chars, "alice", "Alice", [gem("Ruby", 300)]);

    await expect(
      service.consumeMaterialComponent(SESSION, "alice", DIAMOND_300),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("non-consumed component: findItemMatchingComponent finds item (50gp diamond)", async () => {
    const { service, chars } = buildService();
    await createCharacter(chars, "alice", "Alice", [gem("Diamond", 50)]);

    const result = await service.findItemMatchingComponent(SESSION, "alice", DIAMOND_50);
    expect(result.found).toBe(true);
  });
});
