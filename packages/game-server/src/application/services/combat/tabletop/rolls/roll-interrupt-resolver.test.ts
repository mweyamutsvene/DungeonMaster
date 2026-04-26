import { describe, expect, it } from "vitest";
import { RollInterruptResolver } from "./roll-interrupt-resolver.js";
import type { CombatantStateRecord } from "../../../../types.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeCombatant(overrides: Partial<CombatantStateRecord> = {}): CombatantStateRecord {
  return {
    id: "combatant-1",
    encounterId: "enc-1",
    combatantType: "Character",
    characterId: "char-1",
    monsterId: null,
    npcId: null,
    hpCurrent: 20,
    hpMax: 20,
    conditions: [],
    resources: {},
    ...overrides,
  } as unknown as CombatantStateRecord;
}

function withBiEffect(sides: number) {
  return {
    activeEffects: [
      {
        id: "bi-effect-1",
        type: "bonus",
        target: "custom",
        duration: "until_triggered",
        source: "Bardic Inspiration",
        diceValue: { count: 1, sides },
      },
    ],
  };
}

function withLuckPoints(points: number) {
  return { luckPoints: points };
}

const LUCKY_FEAT_SHEET = { featIds: ["feat_lucky"] };
const HALFLING_SHEET = { species: "Halfling" };
const EMPTY_SHEET = {};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("RollInterruptResolver", () => {
  const resolver = new RollInterruptResolver(false);

  // ── no options ──────────────────────────────────────────────────────────

  it("returns empty when combatant is undefined", () => {
    expect(resolver.findAttackInterruptOptions(undefined, EMPTY_SHEET, 10)).toEqual([]);
  });

  it("returns empty when no relevant effects or feats", () => {
    const combatant = makeCombatant();
    expect(resolver.findAttackInterruptOptions(combatant, EMPTY_SHEET, 10)).toEqual([]);
  });

  // ── Bardic Inspiration ──────────────────────────────────────────────────

  it("detects Bardic Inspiration d6 effect", () => {
    const combatant = makeCombatant({ resources: withBiEffect(6) as any });
    const options = resolver.findAttackInterruptOptions(combatant, EMPTY_SHEET, 10);
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ kind: "bardic-inspiration", sides: 6, effectId: "bi-effect-1" });
  });

  it("detects Bardic Inspiration d10 effect", () => {
    const combatant = makeCombatant({ resources: withBiEffect(10) as any });
    const options = resolver.findAttackInterruptOptions(combatant, EMPTY_SHEET, 14);
    expect(options[0]).toMatchObject({ kind: "bardic-inspiration", sides: 10 });
  });

  it("does NOT detect expired BI effect (wrong duration)", () => {
    const combatant = makeCombatant({
      resources: {
        activeEffects: [
          {
            id: "bi-2",
            type: "bonus",
            target: "custom",
            duration: "permanent", // wrong
            source: "Bardic Inspiration",
            diceValue: { count: 1, sides: 6 },
          },
        ],
      } as any,
    });
    expect(resolver.findAttackInterruptOptions(combatant, EMPTY_SHEET, 10)).toHaveLength(0);
  });

  // ── Lucky feat ──────────────────────────────────────────────────────────

  it("detects Lucky feat when luckPoints > 0", () => {
    const combatant = makeCombatant({ resources: withLuckPoints(2) as any });
    const options = resolver.findAttackInterruptOptions(combatant, LUCKY_FEAT_SHEET, 10);
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ kind: "lucky-feat", pointsRemaining: 2 });
  });

  it("does NOT detect Lucky when luckPoints = 0", () => {
    const combatant = makeCombatant({ resources: withLuckPoints(0) as any });
    expect(resolver.findAttackInterruptOptions(combatant, LUCKY_FEAT_SHEET, 10)).toHaveLength(0);
  });

  it("does NOT detect Lucky when feat is absent (no featIds)", () => {
    const combatant = makeCombatant({ resources: withLuckPoints(3) as any });
    expect(resolver.findAttackInterruptOptions(combatant, EMPTY_SHEET, 10)).toHaveLength(0);
  });

  // ── Halfling Lucky ──────────────────────────────────────────────────────

  it("detects Halfling Lucky on nat-1", () => {
    const combatant = makeCombatant();
    const options = resolver.findAttackInterruptOptions(combatant, HALFLING_SHEET, 1);
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ kind: "halfling-lucky" });
  });

  it("does NOT detect Halfling Lucky on non-nat-1", () => {
    const combatant = makeCombatant();
    expect(resolver.findAttackInterruptOptions(combatant, HALFLING_SHEET, 5)).toHaveLength(0);
  });

  it("does NOT detect Halfling Lucky for non-halfling species", () => {
    const combatant = makeCombatant();
    expect(resolver.findAttackInterruptOptions(combatant, { species: "Human" }, 1)).toHaveLength(0);
  });

  // ── Multiple options ────────────────────────────────────────────────────

  it("returns multiple options when both BI and Lucky feat are available", () => {
    const combatant = makeCombatant({
      resources: { ...withBiEffect(8), ...withLuckPoints(1) } as any,
    });
    const options = resolver.findAttackInterruptOptions(combatant, LUCKY_FEAT_SHEET, 10);
    const kinds = options.map(o => o.kind);
    expect(kinds).toContain("bardic-inspiration");
    expect(kinds).toContain("lucky-feat");
    expect(options).toHaveLength(2);
  });

  it("returns Halfling Lucky + BI together on nat-1", () => {
    const combatant = makeCombatant({ resources: withBiEffect(6) as any });
    const options = resolver.findAttackInterruptOptions(combatant, HALFLING_SHEET, 1);
    expect(options.map(o => o.kind)).toContain("halfling-lucky");
    expect(options.map(o => o.kind)).toContain("bardic-inspiration");
  });

  // ── Save path delegates to same logic ──────────────────────────────────

  it("findSaveInterruptOptions returns same options as findAttackInterruptOptions", () => {
    const combatant = makeCombatant({ resources: withBiEffect(6) as any });
    expect(resolver.findSaveInterruptOptions(combatant, EMPTY_SHEET, 10))
      .toEqual(resolver.findAttackInterruptOptions(combatant, EMPTY_SHEET, 10));
  });

  // ── Tactical Mind (findAbilityCheckInterruptOptions) ───────────────────

  describe("findAbilityCheckInterruptOptions — Tactical Mind", () => {
    function withSecondWind(current: number) {
      return { resourcePools: [{ name: "secondWind", current, max: 1 }] };
    }

    it("returns tactical-mind for Fighter L2+ with secondWind remaining", () => {
      const combatant = makeCombatant({ resources: withSecondWind(1) as any });
      const sheet = { className: "fighter", level: 2 };
      const options = resolver.findAbilityCheckInterruptOptions(combatant, sheet);
      expect(options).toContainEqual(expect.objectContaining({ kind: "tactical-mind" }));
    });

    it("does NOT return tactical-mind for Fighter L1 (no feature yet)", () => {
      const combatant = makeCombatant({ resources: withSecondWind(1) as any });
      const sheet = { className: "fighter", level: 1 };
      const options = resolver.findAbilityCheckInterruptOptions(combatant, sheet);
      expect(options.some(o => o.kind === "tactical-mind")).toBe(false);
    });

    it("does NOT return tactical-mind when secondWind is spent", () => {
      const combatant = makeCombatant({ resources: withSecondWind(0) as any });
      const sheet = { className: "fighter", level: 2 };
      const options = resolver.findAbilityCheckInterruptOptions(combatant, sheet);
      expect(options.some(o => o.kind === "tactical-mind")).toBe(false);
    });

    it("does NOT return tactical-mind for non-Fighter class", () => {
      const combatant = makeCombatant({ resources: withSecondWind(1) as any });
      const sheet = { className: "wizard", level: 5 };
      const options = resolver.findAbilityCheckInterruptOptions(combatant, sheet);
      expect(options.some(o => o.kind === "tactical-mind")).toBe(false);
    });

    it("returns empty when combatant is undefined", () => {
      const sheet = { className: "fighter", level: 2 };
      expect(resolver.findAbilityCheckInterruptOptions(undefined, sheet)).toEqual([]);
    });
  });

  // ── buildAttackInterruptData ────────────────────────────────────────────

  it("buildAttackInterruptData returns correct PendingRollInterruptData", () => {
    const combatant = makeCombatant();
    const options = [{ kind: "lucky-feat" as const, pointsRemaining: 1 }];
    const fakeAction: any = { type: "ATTACK", actorId: "char-1" };

    const data = resolver.buildAttackInterruptData(
      "session-1", "enc-1", "char-1",
      8,    // rawD20
      5,    // modifier
      13,   // total
      options,
      fakeAction,
    );

    expect(data.type).toBe("roll_interrupt");
    expect(data.rollKind).toBe("attack");
    expect(data.rawRoll).toEqual([8]);
    expect(data.modifier).toBe(5);
    expect(data.totalBeforeInterrupt).toBe(13);
    expect(data.options).toEqual(options);
    expect(data.resumeContext.kind).toBe("attack");
    expect((data.resumeContext as any).actorId).toBe("char-1");
  });
});
