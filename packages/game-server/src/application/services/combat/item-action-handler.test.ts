import { describe, it, expect, vi, beforeEach } from "vitest";
import { ItemActionHandler } from "./item-action-handler.js";
import { ValidationError } from "../../errors.js";
import type { CombatantStateRecord } from "../../types.js";

function buildCombatant(partial: Partial<CombatantStateRecord> & { id: string }): CombatantStateRecord {
  return {
    id: partial.id,
    encounterId: "enc-1",
    combatantType: "Character",
    characterId: partial.characterId ?? `char-${partial.id}`,
    monsterId: null,
    npcId: null,
    initiative: 10,
    hpCurrent: 20,
    hpMax: 27,
    conditions: [],
    resources: { resourcePools: [] },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...partial,
  } as CombatantStateRecord;
}

const GOODBERRY_ITEM = {
  magicItemId: "goodberry-berry",
  name: "Goodberry",
  equipped: false,
  attuned: false,
  quantity: 3,
  longRestsRemaining: 1,
};

describe("ItemActionHandler — giveItem", () => {
  let actor: CombatantStateRecord;
  let target: CombatantStateRecord;
  let combat: {
    listCombatants: ReturnType<typeof vi.fn>;
    updateCombatantState: ReturnType<typeof vi.fn>;
  };
  let inventoryService: { transferItem: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    actor = buildCombatant({
      id: "actor-1",
      characterId: "char-actor",
      resources: { inventory: [GOODBERRY_ITEM] },
    });
    target = buildCombatant({
      id: "target-1",
      characterId: "char-target",
      resources: { inventory: [] },
    });
    combat = {
      listCombatants: vi.fn().mockResolvedValue([actor, target]),
      updateCombatantState: vi.fn().mockResolvedValue(undefined),
    };
    inventoryService = {
      transferItem: vi.fn().mockResolvedValue({
        fromInventory: [{ ...GOODBERRY_ITEM, quantity: 2 }],
        toInventory: [{ ...GOODBERRY_ITEM, quantity: 1 }],
        item: { ...GOODBERRY_ITEM, quantity: 1 },
        quantity: 1,
      }),
    };
  });

  function buildHandler() {
    return new ItemActionHandler({
      combat: combat as never,
      characters: {} as never,
      inventoryService: inventoryService as never,
    });
  }

  it("transfers the item atomically and mirrors both combatants' live inventory", async () => {
    await buildHandler().giveItem({
      sessionId: "sess-1",
      encounterId: "enc-1",
      actorCombatantId: "actor-1",
      targetCombatantId: "target-1",
      itemName: "Goodberry",
    });
    expect(inventoryService.transferItem).toHaveBeenCalledWith(
      "sess-1",
      "char-actor",
      "char-target",
      "Goodberry",
      1,
    );
    expect(combat.updateCombatantState).toHaveBeenCalledTimes(2);
  });

  it("consumes the free object interaction by default (goodberry-berry.actionCosts.give === 'free-object-interaction')", async () => {
    await buildHandler().giveItem({
      sessionId: "sess-1",
      encounterId: "enc-1",
      actorCombatantId: "actor-1",
      targetCombatantId: "target-1",
      itemName: "Goodberry",
    });
    // First update is the actor (whose resources include the spent interaction).
    const [actorId, actorPatch] = combat.updateCombatantState.mock.calls[0];
    expect(actorId).toBe("actor-1");
    const res = (actorPatch as { resources: Record<string, unknown> }).resources;
    expect(res.objectInteractionUsed).toBe(true);
    expect(res.actionSpent).toBeFalsy();
  });

  it("rejects give when the free object interaction has already been spent", async () => {
    actor.resources = { inventory: [GOODBERRY_ITEM], objectInteractionUsed: true } as never;
    await expect(
      buildHandler().giveItem({
        sessionId: "sess-1",
        encounterId: "enc-1",
        actorCombatantId: "actor-1",
        targetCombatantId: "target-1",
        itemName: "Goodberry",
      }),
    ).rejects.toThrow(ValidationError);
    expect(inventoryService.transferItem).not.toHaveBeenCalled();
  });

  it("rejects when target is not a Character (transfers only go between party members)", async () => {
    target = buildCombatant({
      id: "target-1",
      combatantType: "Monster",
      characterId: null,
      monsterId: "monster-1",
    });
    combat.listCombatants = vi.fn().mockResolvedValue([actor, target]);
    await expect(
      buildHandler().giveItem({
        sessionId: "sess-1",
        encounterId: "enc-1",
        actorCombatantId: "actor-1",
        targetCombatantId: "target-1",
        itemName: "Goodberry",
      }),
    ).rejects.toThrow(/party character/);
  });

  it("throws ValidationError when the item is not in the actor's inventory", async () => {
    actor.resources = { inventory: [] } as never;
    await expect(
      buildHandler().giveItem({
        sessionId: "sess-1",
        encounterId: "enc-1",
        actorCombatantId: "actor-1",
        targetCombatantId: "target-1",
        itemName: "Goodberry",
      }),
    ).rejects.toThrow(/does not have/);
  });
});

describe("ItemActionHandler — administerItem", () => {
  let actor: CombatantStateRecord;
  let target: CombatantStateRecord;
  let combat: {
    listCombatants: ReturnType<typeof vi.fn>;
    updateCombatantState: ReturnType<typeof vi.fn>;
  };
  let characters: { getById: ReturnType<typeof vi.fn>; updateSheet: ReturnType<typeof vi.fn> };
  let events: { append: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    actor = buildCombatant({
      id: "actor-1",
      characterId: "char-actor",
      resources: { inventory: [GOODBERRY_ITEM] },
    });
    target = buildCombatant({
      id: "target-1",
      characterId: "char-target",
      hpCurrent: 0,
      hpMax: 28,
      conditions: ["Unconscious"] as never,
    });
    combat = {
      listCombatants: vi.fn().mockResolvedValue([actor, target]),
      updateCombatantState: vi.fn().mockResolvedValue(undefined),
    };
    characters = {
      getById: vi.fn().mockResolvedValue(null),
      updateSheet: vi.fn().mockResolvedValue(undefined),
    };
    events = { append: vi.fn().mockResolvedValue(undefined) };
  });

  function buildHandler() {
    return new ItemActionHandler({
      combat: combat as never,
      characters: characters as never,
      inventoryService: { transferItem: vi.fn() } as never,
      events: events as never,
    });
  }

  it("heals the target by the flat modifier and removes Unconscious when hpAfter > 0", async () => {
    const result = await buildHandler().administerItem({
      sessionId: "sess-1",
      encounterId: "enc-1",
      actorCombatantId: "actor-1",
      targetCombatantId: "target-1",
      itemName: "Goodberry",
    });
    expect(result.healingApplied).toBe(1);
    // Find the target's updateCombatantState call
    const targetCall = combat.updateCombatantState.mock.calls.find(([id]) => id === "target-1");
    expect(targetCall).toBeDefined();
    const [, patch] = targetCall as [string, Record<string, unknown>];
    expect(patch.hpCurrent).toBe(1);
    // Unconscious removed from conditions
    expect(patch.conditions).not.toContain("Unconscious");
  });

  it("consumes the actor's bonus action (goodberry-berry.actionCosts.administer === 'bonus')", async () => {
    await buildHandler().administerItem({
      sessionId: "sess-1",
      encounterId: "enc-1",
      actorCombatantId: "actor-1",
      targetCombatantId: "target-1",
      itemName: "Goodberry",
    });
    // First update is actor with inventory decrement + bonusActionUsed
    const actorCall = combat.updateCombatantState.mock.calls.find(([id]) => id === "actor-1");
    expect(actorCall).toBeDefined();
    const [, patch] = actorCall as [string, Record<string, unknown>];
    const res = (patch.resources as Record<string, unknown>);
    expect(res.bonusActionUsed).toBe(true);
    expect(res.actionSpent).toBeFalsy();
  });

  it("rejects when the actor's bonus action is already spent", async () => {
    actor.resources = {
      inventory: [GOODBERRY_ITEM],
      bonusActionUsed: true,
    } as never;
    await expect(
      buildHandler().administerItem({
        sessionId: "sess-1",
        encounterId: "enc-1",
        actorCombatantId: "actor-1",
        targetCombatantId: "target-1",
        itemName: "Goodberry",
      }),
    ).rejects.toThrow(/Bonus action already spent/);
  });

  it("emits InventoryChanged with action 'use' when events repo is provided", async () => {
    await buildHandler().administerItem({
      sessionId: "sess-1",
      encounterId: "enc-1",
      actorCombatantId: "actor-1",
      targetCombatantId: "target-1",
      itemName: "Goodberry",
    });
    expect(events.append).toHaveBeenCalledTimes(1);
    const [[, event]] = events.append.mock.calls;
    const payload = (event as { payload: Record<string, unknown> }).payload;
    expect(payload.action).toBe("use");
    expect(payload.itemName).toBe("Goodberry");
    expect(payload.quantity).toBe(1);
  });

  it("rejects when the item has no potionEffects (non-consumable)", async () => {
    actor.resources = {
      inventory: [{
        magicItemId: "potion-of-speed",  // Valid item but we'll force-miss by name
        name: "Flame Tongue",
        equipped: false,
        attuned: false,
        quantity: 1,
      }],
    } as never;
    await expect(
      buildHandler().administerItem({
        sessionId: "sess-1",
        encounterId: "enc-1",
        actorCombatantId: "actor-1",
        targetCombatantId: "target-1",
        itemName: "Flame Tongue",
      }),
    ).rejects.toThrow(/no potionEffects|cannot administer/);
  });
});
