import { describe, it, expect, vi } from "vitest";
import { processSpellCastSideEffects } from "./spell-cast-side-effect-processor.js";
import { ValidationError } from "../../../errors.js";
import type { PreparedSpellDefinition } from "../../../../domain/entities/spells/prepared-spell-definition.js";
import type { SessionCharacterRecord } from "../../../types.js";

const GOODBERRY_SPELL = {
  name: "Goodberry",
  level: 1,
  onCastSideEffects: [
    {
      type: "creates_item" as const,
      itemRef: { magicItemId: "goodberry-berry" },
      quantity: 10,
      longRestsRemaining: 1,
    },
  ],
} as const satisfies PreparedSpellDefinition;

const UNKNOWN_ITEM_SPELL = {
  name: "Unknown Item Maker",
  level: 1,
  onCastSideEffects: [
    {
      type: "creates_item" as const,
      itemRef: { magicItemId: "does-not-exist" },
      quantity: 1,
    },
  ],
} as const satisfies PreparedSpellDefinition;

function buildCaster(id = "char-1"): SessionCharacterRecord {
  return {
    id,
    sessionId: "sess-1",
    name: "Ilynn",
    className: "Druid",
    level: 3,
    sheet: { inventory: [] },
    sheetVersion: 0,
    position: { x: 0, y: 0 },
    subclass: null,
    race: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  } as unknown as SessionCharacterRecord;
}

function buildDeps() {
  return {
    charactersRepo: {
      updateSheet: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof processSpellCastSideEffects>[0]["charactersRepo"],
    combatRepo: {
      updateCombatantState: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof processSpellCastSideEffects>[0]["combatRepo"],
    eventsRepo: {
      append: vi.fn().mockResolvedValue(undefined),
    } as unknown as Parameters<typeof processSpellCastSideEffects>[0]["eventsRepo"],
  };
}

describe("processSpellCastSideEffects", () => {
  it("is a no-op for spells without onCastSideEffects", async () => {
    const spell: PreparedSpellDefinition = { name: "No Op", level: 1 };
    const { charactersRepo, combatRepo } = buildDeps();
    await processSpellCastSideEffects({
      spell,
      caster: buildCaster(),
      actorCombatant: null,
      sessionId: "sess-1",
      charactersRepo,
      combatRepo,
    });
    expect(charactersRepo.updateSheet).not.toHaveBeenCalled();
    expect(combatRepo.updateCombatantState).not.toHaveBeenCalled();
  });

  it("is a no-op when caster is null (no sheet to write to)", async () => {
    const { charactersRepo, combatRepo } = buildDeps();
    await processSpellCastSideEffects({
      spell: GOODBERRY_SPELL,
      caster: null,
      actorCombatant: null,
      sessionId: "sess-1",
      charactersRepo,
      combatRepo,
    });
    expect(charactersRepo.updateSheet).not.toHaveBeenCalled();
  });

  it("creates the declared item on the sheet with correct shape (Goodberry → 10 goodberry-berry w/ longRestsRemaining=1)", async () => {
    const caster = buildCaster();
    const { charactersRepo, combatRepo } = buildDeps();
    await processSpellCastSideEffects({
      spell: GOODBERRY_SPELL,
      caster,
      actorCombatant: null,
      sessionId: "sess-1",
      charactersRepo,
      combatRepo,
    });
    expect(charactersRepo.updateSheet).toHaveBeenCalledTimes(1);
    const [[calledId, calledSheet]] = (charactersRepo.updateSheet as ReturnType<typeof vi.fn>).mock.calls;
    expect(calledId).toBe(caster.id);
    const inventory = (calledSheet as { inventory: unknown[] }).inventory;
    expect(inventory).toHaveLength(1);
    expect(inventory[0]).toMatchObject({
      magicItemId: "goodberry-berry",
      name: "Goodberry",
      quantity: 10,
      longRestsRemaining: 1,
      equipped: false,
      attuned: false,
    });
  });

  it("dual-writes to actorCombatant.resources.inventory when a live combatant is provided", async () => {
    const caster = buildCaster();
    const { charactersRepo, combatRepo } = buildDeps();
    const actorCombatant = { id: "combatant-1", resources: { inventory: [] } };
    await processSpellCastSideEffects({
      spell: GOODBERRY_SPELL,
      caster,
      actorCombatant,
      sessionId: "sess-1",
      charactersRepo,
      combatRepo,
    });
    expect(combatRepo.updateCombatantState).toHaveBeenCalledTimes(1);
    const [[, patch]] = (combatRepo.updateCombatantState as ReturnType<typeof vi.fn>).mock.calls;
    const inv = (patch as { resources: { inventory: unknown[] } }).resources.inventory;
    expect(inv).toHaveLength(1);
    expect(inv[0]).toMatchObject({ magicItemId: "goodberry-berry", quantity: 10 });
  });

  it("does NOT touch the combat repo for out-of-combat casts (no actorCombatant)", async () => {
    const caster = buildCaster();
    const { charactersRepo, combatRepo } = buildDeps();
    await processSpellCastSideEffects({
      spell: GOODBERRY_SPELL,
      caster,
      actorCombatant: null,
      sessionId: "sess-1",
      charactersRepo,
      combatRepo,
    });
    expect(charactersRepo.updateSheet).toHaveBeenCalled();
    expect(combatRepo.updateCombatantState).not.toHaveBeenCalled();
  });

  it("throws ValidationError on unresolved magicItemId (fail fast — catches catalog typos)", async () => {
    const { charactersRepo, combatRepo } = buildDeps();
    await expect(
      processSpellCastSideEffects({
        spell: UNKNOWN_ITEM_SPELL,
        caster: buildCaster(),
        actorCombatant: null,
        sessionId: "sess-1",
        charactersRepo,
        combatRepo,
      }),
    ).rejects.toThrow(ValidationError);
    expect(charactersRepo.updateSheet).not.toHaveBeenCalled();
  });

  it("emits one InventoryChanged event per created stack when eventsRepo is provided", async () => {
    const { charactersRepo, combatRepo, eventsRepo } = buildDeps();
    await processSpellCastSideEffects({
      spell: GOODBERRY_SPELL,
      caster: buildCaster(),
      actorCombatant: null,
      sessionId: "sess-1",
      charactersRepo,
      combatRepo,
      eventsRepo,
    });
    expect(eventsRepo!.append).toHaveBeenCalledTimes(1);
    const [[sessionId, event]] = (eventsRepo!.append as ReturnType<typeof vi.fn>).mock.calls;
    expect(sessionId).toBe("sess-1");
    expect((event as { type: string }).type).toBe("InventoryChanged");
    expect((event as { payload: { action: string; itemName: string; quantity: number } }).payload).toMatchObject({
      action: "create",
      itemName: "Goodberry",
      quantity: 10,
    });
  });
});
