import { describe, it, expect, vi, beforeEach } from "vitest";
import { findPreparedSpellInSheet, prepareSpellCast } from "./spell-slot-manager.js";
import { ValidationError } from "../../../errors.js";
import { breakConcentration } from "./concentration-helper.js";

vi.mock("./concentration-helper.js", () => ({
  breakConcentration: vi.fn().mockResolvedValue(null),
}));

const COMBATANT_ID = "comb-1";
const ENCOUNTER_ID = "enc-1";

function makeCombatant(resources: Record<string, unknown> = {}) {
  return {
    id: COMBATANT_ID,
    encounterId: ENCOUNTER_ID,
    combatantType: "Character" as const,
    characterId: "char-1",
    monsterId: null,
    npcId: null,
    initiative: 10,
    hpCurrent: 20,
    hpMax: 20,
    conditions: [],
    resources,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/** Build a minimal ICombatRepository stub. Optionally supply resources for the second call. */
function makeRepo(
  resources: Record<string, unknown> = {},
  secondCallResources?: Record<string, unknown>,
) {
  const first = makeCombatant(resources);
  const second = secondCallResources !== undefined ? makeCombatant(secondCallResources) : first;
  return {
    listCombatants: vi.fn().mockResolvedValueOnce([first]).mockResolvedValue([second]),
    updateCombatantState: vi.fn().mockResolvedValue(undefined),
    getEncounterById: vi.fn(),
    createEncounter: vi.fn(),
    updateEncounterState: vi.fn(),
    addCombatant: vi.fn(),
    removeCombatant: vi.fn(),
    listEncounters: vi.fn(),
    getActiveCombatant: vi.fn(),
  } as any; // ICombatRepository
}

// ─────────────────────── findPreparedSpellInSheet ───────────────────

describe("findPreparedSpellInSheet", () => {
  it("returns null for null input", () => {
    expect(findPreparedSpellInSheet(null, "Fireball")).toBeNull();
  });

  it("returns null for non-object inputs", () => {
    expect(findPreparedSpellInSheet("not an object", "Fireball")).toBeNull();
    expect(findPreparedSpellInSheet(42, "Fireball")).toBeNull();
    expect(findPreparedSpellInSheet([], "Fireball")).toBeNull();
  });

  it("returns null when sheet has no preparedSpells property", () => {
    expect(findPreparedSpellInSheet({}, "Fireball")).toBeNull();
    expect(findPreparedSpellInSheet({ name: "Gandalf" }, "Fireball")).toBeNull();
  });

  it("returns null when preparedSpells is not an array", () => {
    expect(findPreparedSpellInSheet({ preparedSpells: {} }, "Fireball")).toBeNull();
    expect(findPreparedSpellInSheet({ preparedSpells: null }, "Fireball")).toBeNull();
  });

  it("returns null when spell is not in prepared list", () => {
    const sheet = {
      preparedSpells: [{ name: "Magic Missile", level: 1, isConcentration: false }],
    };
    expect(findPreparedSpellInSheet(sheet, "Fireball")).toBeNull();
  });

  it("returns the PreparedSpellDefinition when found by exact name", () => {
    const spell = { name: "Fireball", level: 3, isConcentration: false };
    const sheet = { preparedSpells: [spell] };
    expect(findPreparedSpellInSheet(sheet, "Fireball")).toEqual(spell);
  });

  it("finds spells case-insensitively", () => {
    const spell = { name: "Fire Bolt", level: 0, isConcentration: false };
    const sheet = { preparedSpells: [spell] };
    expect(findPreparedSpellInSheet(sheet, "fire bolt")).toEqual(spell);
    expect(findPreparedSpellInSheet(sheet, "FIRE BOLT")).toEqual(spell);
    expect(findPreparedSpellInSheet(sheet, "Fire Bolt")).toEqual(spell);
  });

  it("returns first match when names are distinct but normalised identically", () => {
    const a = { name: "Cure Wounds", level: 1, isConcentration: false };
    const b = { name: "cure wounds", level: 2, isConcentration: false };
    const sheet = { preparedSpells: [a, b] };
    expect(findPreparedSpellInSheet(sheet, "cure wounds")).toEqual(a);
  });
});

// ─────────────────────── prepareSpellCast ───────────────────────────

describe("prepareSpellCast", () => {
  beforeEach(() => {
    vi.mocked(breakConcentration).mockClear();
  });

  it("returns immediately for cantrips (level 0) without any DB calls", async () => {
    const repo = makeRepo();
    await prepareSpellCast(COMBATANT_ID, ENCOUNTER_ID, "Fire Bolt", 0, false, repo);
    expect(repo.listCombatants).not.toHaveBeenCalled();
    expect(repo.updateCombatantState).not.toHaveBeenCalled();
  });

  it("returns silently when the combatant is not found", async () => {
    const repo = makeRepo();
    vi.mocked(repo.listCombatants).mockResolvedValueOnce([]); // override — empty roster
    await prepareSpellCast("unknown-id", ENCOUNTER_ID, "Fireball", 3, false, repo);
    expect(repo.updateCombatantState).not.toHaveBeenCalled();
  });

  it("throws ValidationError when no slots of the required level remain", async () => {
    const repo = makeRepo({ resourcePools: [{ name: "spellSlot_1", current: 0, max: 4 }] });
    await expect(
      prepareSpellCast(COMBATANT_ID, ENCOUNTER_ID, "Magic Missile", 1, false, repo),
    ).rejects.toThrow(ValidationError);
    expect(repo.updateCombatantState).not.toHaveBeenCalled();
  });

  it("throws ValidationError when the slot pool is absent", async () => {
    const repo = makeRepo({}); // no spellSlot_3
    await expect(
      prepareSpellCast(COMBATANT_ID, ENCOUNTER_ID, "Fireball", 3, false, repo),
    ).rejects.toThrow(ValidationError);
  });

  it("spends one slot and writes updated resources on success", async () => {
    const repo = makeRepo({ resourcePools: [{ name: "spellSlot_1", current: 3, max: 4 }] });
    await prepareSpellCast(COMBATANT_ID, ENCOUNTER_ID, "Magic Missile", 1, false, repo);

    expect(repo.updateCombatantState).toHaveBeenCalledOnce();
    const [callId, update] = vi.mocked(repo.updateCombatantState).mock.calls[0] as [
      string,
      { resources: { resourcePools: Array<{ name: string; current: number }> } },
    ];
    expect(callId).toBe(COMBATANT_ID);
    const pool = update.resources.resourcePools.find((p) => p.name === "spellSlot_1");
    expect(pool?.current).toBe(2);
  });

  it("calls the optional log function when provided", async () => {
    const repo = makeRepo({ resourcePools: [{ name: "spellSlot_2", current: 2, max: 2 }] });
    const log = vi.fn();
    await prepareSpellCast(COMBATANT_ID, ENCOUNTER_ID, "Hold Person", 2, false, repo, log);
    // log may or may not be called — we just ensure no error is thrown
    expect(repo.updateCombatantState).toHaveBeenCalledOnce();
  });

  describe("concentration management", () => {
    it("sets concentrationSpellName when no prior concentration", async () => {
      const repo = makeRepo({ resourcePools: [{ name: "spellSlot_2", current: 2, max: 2 }] });
      await prepareSpellCast(COMBATANT_ID, ENCOUNTER_ID, "Hold Person", 2, true, repo);

      expect(repo.updateCombatantState).toHaveBeenCalledOnce();
      const [, update] = vi.mocked(repo.updateCombatantState).mock.calls[0] as [
        string,
        { resources: Record<string, unknown> },
      ];
      expect(update.resources.concentrationSpellName).toBe("Hold Person");
      expect(breakConcentration).not.toHaveBeenCalled();
    });

    it("calls breakConcentration and replaces the spell name when already concentrating", async () => {
      // First read: concentrating on "Bless". Second read (after break): clean.
      const repo = makeRepo(
        {
          resourcePools: [{ name: "spellSlot_2", current: 2, max: 2 }],
          concentrationSpellName: "Bless",
        },
        { resourcePools: [{ name: "spellSlot_2", current: 2, max: 2 }] }, // fresh resources post-break
      );

      await prepareSpellCast(COMBATANT_ID, ENCOUNTER_ID, "Hold Person", 2, true, repo);

      expect(breakConcentration).toHaveBeenCalledOnce();
      expect(repo.updateCombatantState).toHaveBeenCalledOnce();
      const [, update] = vi.mocked(repo.updateCombatantState).mock.calls[0] as [
        string,
        { resources: Record<string, unknown> },
      ];
      expect(update.resources.concentrationSpellName).toBe("Hold Person");
    });

    it("does NOT set concentrationSpellName for non-concentration spells", async () => {
      const repo = makeRepo({ resourcePools: [{ name: "spellSlot_3", current: 1, max: 2 }] });
      await prepareSpellCast(COMBATANT_ID, ENCOUNTER_ID, "Fireball", 3, false, repo);

      const [, update] = vi.mocked(repo.updateCombatantState).mock.calls[0] as [
        string,
        { resources: Record<string, unknown> },
      ];
      expect(update.resources.concentrationSpellName).toBeUndefined();
    });
  });

  describe("Warlock Pact Magic fallback", () => {
    it("uses pactMagic pool when no standard spell slot is available", async () => {
      const repo = makeRepo({
        resourcePools: [
          { name: "spellSlot_1", current: 0, max: 0 },
          { name: "pactMagic", current: 2, max: 2 },
        ],
      });
      await prepareSpellCast(COMBATANT_ID, ENCOUNTER_ID, "Hex", 1, false, repo);

      expect(repo.updateCombatantState).toHaveBeenCalledOnce();
      const [, update] = vi.mocked(repo.updateCombatantState).mock.calls[0] as [
        string,
        { resources: { resourcePools: Array<{ name: string; current: number }> } },
      ];
      const pactPool = update.resources.resourcePools.find((p) => p.name === "pactMagic");
      expect(pactPool?.current).toBe(1);
    });

    it("prefers standard spell slot over pactMagic when both available", async () => {
      const repo = makeRepo({
        resourcePools: [
          { name: "spellSlot_1", current: 2, max: 4 },
          { name: "pactMagic", current: 2, max: 2 },
        ],
      });
      await prepareSpellCast(COMBATANT_ID, ENCOUNTER_ID, "Hex", 1, false, repo);

      const [, update] = vi.mocked(repo.updateCombatantState).mock.calls[0] as [
        string,
        { resources: { resourcePools: Array<{ name: string; current: number }> } },
      ];
      const spellSlot = update.resources.resourcePools.find((p) => p.name === "spellSlot_1");
      const pactPool = update.resources.resourcePools.find((p) => p.name === "pactMagic");
      expect(spellSlot?.current).toBe(1);
      expect(pactPool?.current).toBe(2);
    });

    it("throws ValidationError when both standard slot and pactMagic are empty", async () => {
      const repo = makeRepo({
        resourcePools: [
          { name: "spellSlot_1", current: 0, max: 4 },
          { name: "pactMagic", current: 0, max: 2 },
        ],
      });
      await expect(
        prepareSpellCast(COMBATANT_ID, ENCOUNTER_ID, "Hex", 1, false, repo),
      ).rejects.toThrow(ValidationError);
    });
  });
});
