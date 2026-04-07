import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BuffDebuffSpellDeliveryHandler } from "./buff-debuff-spell-delivery-handler.js";
import type { PreparedSpellDefinition } from "../../../../../domain/entities/spells/prepared-spell-definition.js";
import type { SpellDeliveryDeps } from "./spell-delivery-handler.js";

// Minimal mock for SpellDeliveryDeps — only castSpell is called in the empty-effects guard path
function makeMockDeps(overrides?: Partial<SpellDeliveryDeps>): SpellDeliveryDeps {
  return {
    deps: {
      actions: {
        castSpell: vi.fn().mockResolvedValue(undefined),
      },
    } as any,
    eventEmitter: null as any,
    debugLogsEnabled: false,
    savingThrowResolver: null,
    ...overrides,
  };
}

// Minimal SpellCastingContext for the empty-effects warning path
function makeSpellCtx(spellName: string, effects: PreparedSpellDefinition["effects"]) {
  return {
    sessionId: "session-test",
    encounterId: "enc-test",
    actorId: "actor-test",
    actor: { id: "actor-test" },
    castInfo: { spellName },
    spellMatch: {
      name: spellName,
      level: 1,
      effects,
    } as PreparedSpellDefinition,
    spellLevel: 1,
    isConcentration: false,
    sheet: {},
    characters: [],
    roster: [] as any,
    encounter: {},
    combatants: [],
    actorCombatant: null,
  } as any;
}

describe("SPELL-M8: BuffDebuffSpellDeliveryHandler", () => {
  describe("canHandle", () => {
    it("returns false when spell has no effects (empty array)", () => {
      const handler = new BuffDebuffSpellDeliveryHandler(makeMockDeps());
      const spell: PreparedSpellDefinition = { name: "MinorBuff", level: 1, effects: [] };
      expect(handler.canHandle(spell)).toBe(false);
    });

    it("returns false when spell has undefined effects", () => {
      const handler = new BuffDebuffSpellDeliveryHandler(makeMockDeps());
      const spell: PreparedSpellDefinition = { name: "OtherSpell", level: 1 };
      expect(handler.canHandle(spell)).toBe(false);
    });

    it("returns true when spell has at least one defined effect", () => {
      const handler = new BuffDebuffSpellDeliveryHandler(makeMockDeps());
      const spell: PreparedSpellDefinition = {
        name: "Bless",
        level: 1,
        concentration: true,
        effects: [
          {
            type: "advantage",
            target: "attack_rolls",
            appliesTo: "allies",
            duration: "concentration",
          },
        ],
      };
      expect(handler.canHandle(spell)).toBe(true);
    });
  });

  describe("handle — empty effects guard (defensive warning path)", () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
    });

    it("emits a console.warn when handle() is called with empty effects", async () => {
      const mockDeps = makeMockDeps();
      const handler = new BuffDebuffSpellDeliveryHandler(mockDeps);
      const ctx = makeSpellCtx("MysteryBuff", []);

      await handler.handle(ctx);

      expect(warnSpy).toHaveBeenCalledOnce();
      const warnMsg = warnSpy.mock.calls[0]?.[0] as string;
      expect(warnMsg).toContain("MysteryBuff");
      expect(warnMsg).toContain("no effects defined");
    });

    it("does NOT emit a console.warn when spell has defined effects", async () => {
      const mockDeps = makeMockDeps({
        deps: {
          actions: { castSpell: vi.fn().mockResolvedValue(undefined) },
          combatRepo: {
            updateCombatantState: vi.fn().mockResolvedValue(undefined),
          },
        } as any,
      });
      const handler = new BuffDebuffSpellDeliveryHandler(mockDeps);

      // Spell with one effect but no valid targets (empty combatants) → no warn
      const ctx = makeSpellCtx("Bless", [
        {
          type: "advantage",
          target: "attack_rolls",
          appliesTo: "self",
          duration: "concentration",
        } as any,
      ]);
      // actorCombatant is null, so target list resolves to empty — but no warn emitted
      await handler.handle(ctx);

      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
});
