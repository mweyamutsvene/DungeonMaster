/**
 * SPELL-BANE: BuffDebuffSpellDeliveryHandler — Bane save-on-cast coverage.
 *
 * Bane (L1, CHA save, concentration) is a save-on-cast spell: each enemy rolls a
 * CHA save on cast, and the −1d4 attack/save penalty effect is installed ONLY on
 * creatures that FAIL the save. This test drives `handle()` with 3 enemy
 * combatants and asserts:
 *   - Enemy A (save fails) → two penalty ActiveEffects installed (attack_rolls + saving_throws)
 *     each with diceValue {count:1, sides:4}.
 *   - Enemy B/C (save succeeds) → NO ActiveEffects installed.
 */

import { describe, it, expect, vi } from "vitest";
import { BuffDebuffSpellDeliveryHandler } from "./buff-debuff-spell-delivery-handler.js";
import type { PreparedSpellDefinition } from "../../../../../domain/entities/spells/prepared-spell-definition.js";
import type { SpellDeliveryDeps } from "./spell-delivery-handler.js";

function makeBaneSpell(): PreparedSpellDefinition {
  return {
    name: "Bane",
    level: 1,
    concentration: true,
    saveAbility: "charisma",
    effects: [
      {
        type: "penalty" as const,
        target: "attack_rolls" as const,
        diceValue: { count: 1, sides: 4 },
        duration: "concentration" as const,
        appliesTo: "enemies" as const,
      },
      {
        type: "penalty" as const,
        target: "saving_throws" as const,
        diceValue: { count: 1, sides: 4 },
        duration: "concentration" as const,
        appliesTo: "enemies" as const,
      },
    ],
  } as PreparedSpellDefinition;
}

function makeEnemyCombatant(id: string, monsterId: string) {
  return {
    id,
    combatantType: "Monster" as const,
    monsterId,
    hpCurrent: 30,
    conditions: [],
    resources: {},
  };
}

describe("SPELL-BANE: BuffDebuffSpellDeliveryHandler (Bane save-on-cast)", () => {
  it("installs Bane penalty effects ONLY on enemies that fail the CHA save", async () => {
    const updateCombatantState = vi.fn().mockResolvedValue(undefined);
    const castSpell = vi.fn().mockResolvedValue(undefined);
    const listCombatants = vi.fn();
    const listBySessionMon = vi.fn().mockResolvedValue([]);
    const listBySessionNpc = vi.fn().mockResolvedValue([]);

    // Caster (Cleric) and three enemy monsters.
    const casterC = {
      id: "c-caster",
      combatantType: "Character" as const,
      characterId: "char-cleric",
      hpCurrent: 27,
      conditions: [],
      resources: {},
    };
    const m1 = makeEnemyCombatant("c-m1", "mon-1"); // Will FAIL save
    const m2 = makeEnemyCombatant("c-m2", "mon-2"); // Will SUCCEED
    const m3 = makeEnemyCombatant("c-m3", "mon-3"); // Will SUCCEED
    const combatants = [casterC, m1, m2, m3];

    listCombatants.mockResolvedValue(combatants);

    // Mock SavingThrowResolver: succeed=false for mon-1, succeed=true for others.
    const savingThrowResolver = {
      buildPendingAction: vi.fn(({ actorId, ability, dc, reason }) => ({
        actorId,
        ability,
        dc,
        reason,
      })),
      resolve: vi.fn(async (saveAction: any) => {
        const success = saveAction.actorId !== "mon-1";
        return {
          success,
          rawRoll: 10,
          modifier: 0,
          total: 10,
          dc: saveAction.dc,
          appliedOutcome: { summary: success ? "saved" : "failed" },
          conditionsApplied: [],
        };
      }),
    };

    const handlerDeps: SpellDeliveryDeps = {
      deps: {
        actions: { castSpell },
        combatRepo: { updateCombatantState, listCombatants },
        monsters: { listBySession: listBySessionMon },
        npcs: { listBySession: listBySessionNpc },
      } as any,
      eventEmitter: null as any,
      debugLogsEnabled: false,
      savingThrowResolver: savingThrowResolver as any,
    };

    const handler = new BuffDebuffSpellDeliveryHandler(handlerDeps);

    const ctx: any = {
      sessionId: "sess-1",
      encounterId: "enc-1",
      actorId: "char-cleric",
      actor: { id: "char-cleric" },
      castInfo: { spellName: "Bane" },
      spellMatch: makeBaneSpell(),
      spellLevel: 1,
      isConcentration: true,
      isBonusAction: false,
      sheet: {
        abilityScores: { wisdom: 16 },
        className: "Cleric",
        level: 3,
      },
      characters: [{ id: "char-cleric", sheet: {} }],
      roster: [
        { kind: "monster", monster: { id: "mon-1", name: "Goblin A" } },
        { kind: "monster", monster: { id: "mon-2", name: "Goblin B" } },
        { kind: "monster", monster: { id: "mon-3", name: "Goblin C" } },
      ],
      encounter: { id: "enc-1" },
      combatants,
      actorCombatant: casterC,
    };

    const result = await handler.handle(ctx);

    // Action consumed.
    expect(castSpell).toHaveBeenCalledTimes(1);

    // Save resolver invoked once per enemy (results cached by combatantId, 2 effects share the cache).
    // Each enemy rolls CHA save exactly once.
    expect(savingThrowResolver.resolve).toHaveBeenCalledTimes(3);

    // Effect installation: exactly two updates on the failed-save enemy (one per effect declaration).
    const updatesForM1 = updateCombatantState.mock.calls.filter((c) => c[0] === "c-m1");
    const updatesForM2 = updateCombatantState.mock.calls.filter((c) => c[0] === "c-m2");
    const updatesForM3 = updateCombatantState.mock.calls.filter((c) => c[0] === "c-m3");
    expect(updatesForM1.length).toBe(2);
    expect(updatesForM2.length).toBe(0);
    expect(updatesForM3.length).toBe(0);

    // The final snapshot written to mon-1 should carry BOTH penalty effects.
    const finalResources = updatesForM1[updatesForM1.length - 1][1].resources;
    const activeEffects = finalResources.activeEffects as any[];
    expect(activeEffects.length).toBe(2);
    for (const eff of activeEffects) {
      expect(eff.type).toBe("penalty");
      expect(eff.diceValue).toEqual({ count: 1, sides: 4 });
      expect(eff.source).toBe("Bane");
      expect(eff.duration).toBe("concentration");
    }
    const targets = activeEffects.map((e) => e.target).sort();
    expect(targets).toEqual(["attack_rolls", "saving_throws"]);

    // Result message should reference the spell + one affected target.
    expect(result.actionComplete).toBe(true);
    expect(result.message).toMatch(/Bane/i);
  });
});
