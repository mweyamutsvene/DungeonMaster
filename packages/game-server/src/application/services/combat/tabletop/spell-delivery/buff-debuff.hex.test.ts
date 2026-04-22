/**
 * Lock-in test for GAP-6: Hex bonus damage on Eldritch Blast beams.
 *
 * Verifies that BuffDebuffSpellDeliveryHandler, when handling Hex, installs an
 * ActiveEffect on the CASTER's resources (not the victim's) with:
 *   - target: 'damage_rolls'
 *   - type:   'bonus'
 *   - diceValue: { count: 1, sides: 6 }
 *   - damageType: 'necrotic'
 *   - targetCombatantId: <victim entity id>
 *
 * This is the contract that `damage-resolver` depends on to add +1d6 necrotic
 * to each Eldritch Blast beam. Regression here silently drops Hex damage.
 */

import { describe, expect, it, vi } from "vitest";
import { BuffDebuffSpellDeliveryHandler } from "./buff-debuff-spell-delivery-handler.js";
import { HEX } from "../../../../../domain/entities/spells/catalog/level-1.js";
import type { SpellDeliveryDeps } from "./spell-delivery-handler.js";
import type { PreparedSpellDefinition } from "../../../../../domain/entities/spells/prepared-spell-definition.js";

type UpdateCall = { id: string; body: { resources?: any; hpCurrent?: number } };

function makeDeps(updateCalls: UpdateCall[], refreshedCombatants: any[]): SpellDeliveryDeps {
  return {
    deps: {
      actions: { castSpell: vi.fn().mockResolvedValue(undefined) },
      combatRepo: {
        updateCombatantState: vi.fn((id: string, body: any) => {
          updateCalls.push({ id, body });
          return Promise.resolve();
        }),
        listCombatants: vi.fn().mockResolvedValue(refreshedCombatants),
      },
      monsters: { listBySession: vi.fn().mockResolvedValue([]) },
      npcs: { listBySession: vi.fn().mockResolvedValue([]) },
    } as any,
    eventEmitter: null as any,
    debugLogsEnabled: false,
    savingThrowResolver: null,
  };
}

describe("GAP-6: Hex on caster's resources (EB beam rider)", () => {
  it("installs a damage_rolls dice-bonus on the caster scoped to the victim", async () => {
    const casterCombatantId = "cbt-warlock";
    const casterEntityId = "warlock-malachar";
    const victimCombatantId = "cbt-shadow-construct";
    const victimEntityId = "monster-shadow-construct";

    const casterCombatant = {
      id: casterCombatantId,
      combatantType: "Character",
      characterId: casterEntityId,
      hpCurrent: 38,
      hpMax: 38,
      resources: {},
    };
    const victimCombatant = {
      id: victimCombatantId,
      combatantType: "Monster",
      monsterId: victimEntityId,
      hpCurrent: 200,
      hpMax: 200,
      resources: {},
    };

    const updateCalls: UpdateCall[] = [];
    const refreshedCombatants = [
      { ...casterCombatant }, // will be looked up by the handler for bonusActionUsed patch
      { ...victimCombatant },
    ];
    const handlerDeps = makeDeps(updateCalls, refreshedCombatants);

    const handler = new BuffDebuffSpellDeliveryHandler(handlerDeps);

    const ctx = {
      sessionId: "sess-1",
      encounterId: "enc-1",
      actorId: casterEntityId,
      castInfo: { spellName: "Hex", targetName: "Shadow Construct" },
      spellMatch: HEX as PreparedSpellDefinition,
      spellLevel: 1,
      isConcentration: true,
      isBonusAction: true,
      sheet: { abilityScores: { charisma: 18 } },
      actor: { type: "Character", characterId: casterEntityId },
      roster: {
        characters: [{ id: casterEntityId, name: "Malachar" }],
        monsters: [{ id: victimEntityId, name: "Shadow Construct" }],
        npcs: [],
      },
      encounter: { id: "enc-1", round: 1, turn: 0 },
      combatants: [casterCombatant, victimCombatant],
      actorCombatant: casterCombatant,
      characters: [
        { id: casterEntityId, name: "Malachar", sheet: { abilityScores: { charisma: 18 } } },
      ],
    } as any;

    await handler.handle(ctx);

    // The handler must persist the caster's resources with the Hex damage_rolls rider
    // BEFORE patching bonusActionUsed. Find the update that carries activeEffects.
    const casterResourceWrites = updateCalls.filter(
      (c) => c.id === casterCombatantId && c.body.resources !== undefined,
    );
    expect(casterResourceWrites.length).toBeGreaterThan(0);

    // Any write on the caster must carry a Hex damage_rolls effect (we check all
    // writes because the bonusActionUsed patch may overwrite in stale-mocks, and
    // the third test covers the re-fetch-preserves-effects contract).
    const hexDamageEffect = casterResourceWrites
      .flatMap((w) => ((w.body.resources as any)?.activeEffects ?? []) as any[])
      .find((e) => e.source === "Hex" && e.target === "damage_rolls");
    expect(hexDamageEffect, "Hex damage_rolls effect must be present on caster").toBeDefined();
    expect(hexDamageEffect.type).toBe("bonus");
    expect(hexDamageEffect.diceValue).toEqual({ count: 1, sides: 6 });
    expect(hexDamageEffect.damageType).toBe("necrotic");
    expect(hexDamageEffect.targetCombatantId).toBe(victimEntityId);
    expect(hexDamageEffect.sourceCombatantId).toBe(casterEntityId);
  });

  it("does NOT install the damage_rolls effect on the victim's resources", async () => {
    const casterCombatantId = "cbt-warlock";
    const casterEntityId = "warlock-malachar";
    const victimCombatantId = "cbt-shadow-construct";
    const victimEntityId = "monster-shadow-construct";

    const casterCombatant = {
      id: casterCombatantId,
      combatantType: "Character",
      characterId: casterEntityId,
      hpCurrent: 38,
      hpMax: 38,
      resources: {},
    };
    const victimCombatant = {
      id: victimCombatantId,
      combatantType: "Monster",
      monsterId: victimEntityId,
      hpCurrent: 200,
      hpMax: 200,
      resources: {},
    };

    const updateCalls: UpdateCall[] = [];
    const handlerDeps = makeDeps(updateCalls, [casterCombatant, victimCombatant]);

    const handler = new BuffDebuffSpellDeliveryHandler(handlerDeps);
    const ctx = {
      sessionId: "sess-1",
      encounterId: "enc-1",
      actorId: casterEntityId,
      castInfo: { spellName: "Hex", targetName: "Shadow Construct" },
      spellMatch: HEX as PreparedSpellDefinition,
      spellLevel: 1,
      isConcentration: true,
      isBonusAction: true,
      sheet: { abilityScores: { charisma: 18 } },
      actor: { type: "Character", characterId: casterEntityId },
      roster: {
        characters: [{ id: casterEntityId, name: "Malachar" }],
        monsters: [{ id: victimEntityId, name: "Shadow Construct" }],
        npcs: [],
      },
      encounter: { id: "enc-1", round: 1, turn: 0 },
      combatants: [casterCombatant, victimCombatant],
      actorCombatant: casterCombatant,
      characters: [
        { id: casterEntityId, name: "Malachar", sheet: { abilityScores: { charisma: 18 } } },
      ],
    } as any;

    await handler.handle(ctx);

    // Any writes targeted at the victim combatant must NOT carry a damage_rolls caster rider.
    const victimWrites = updateCalls.filter((c) => c.id === victimCombatantId);
    for (const w of victimWrites) {
      const effects: any[] = (w.body.resources as any)?.activeEffects ?? [];
      const damageRider = effects.find(
        (e) => e.source === "Hex" && e.target === "damage_rolls",
      );
      expect(damageRider).toBeUndefined();
    }
  });

  it("preserves the Hex effect after the bonusActionUsed patch (re-fetch pattern)", async () => {
    const casterCombatantId = "cbt-warlock";
    const casterEntityId = "warlock-malachar";
    const victimCombatantId = "cbt-shadow-construct";
    const victimEntityId = "monster-shadow-construct";

    const casterCombatant = {
      id: casterCombatantId,
      combatantType: "Character",
      characterId: casterEntityId,
      hpCurrent: 38,
      hpMax: 38,
      resources: {},
    };
    const victimCombatant = {
      id: victimCombatantId,
      combatantType: "Monster",
      monsterId: victimEntityId,
      hpCurrent: 200,
      hpMax: 200,
      resources: {},
    };

    const updateCalls: UpdateCall[] = [];
    // Simulate the live repo: after the first updateCombatantState write, the caster's
    // resources include the Hex effect. The handler re-fetches via listCombatants before
    // patching bonusActionUsed — this simulator mimics that behaviour.
    let casterResourcesAfterFirstWrite: any = {};
    const combatRepo: any = {
      updateCombatantState: vi.fn((id: string, body: any) => {
        updateCalls.push({ id, body });
        if (id === casterCombatantId && body.resources) {
          casterResourcesAfterFirstWrite = body.resources;
        }
        return Promise.resolve();
      }),
      listCombatants: vi.fn().mockImplementation(() => {
        return Promise.resolve([
          { ...casterCombatant, resources: casterResourcesAfterFirstWrite },
          { ...victimCombatant },
        ]);
      }),
    };

    const handlerDeps: SpellDeliveryDeps = {
      deps: {
        actions: { castSpell: vi.fn().mockResolvedValue(undefined) },
        combatRepo,
        monsters: { listBySession: vi.fn().mockResolvedValue([]) },
        npcs: { listBySession: vi.fn().mockResolvedValue([]) },
      } as any,
      eventEmitter: null as any,
      debugLogsEnabled: false,
      savingThrowResolver: null,
    };

    const handler = new BuffDebuffSpellDeliveryHandler(handlerDeps);
    const ctx = {
      sessionId: "sess-1",
      encounterId: "enc-1",
      actorId: casterEntityId,
      castInfo: { spellName: "Hex", targetName: "Shadow Construct" },
      spellMatch: HEX as PreparedSpellDefinition,
      spellLevel: 1,
      isConcentration: true,
      isBonusAction: true,
      sheet: { abilityScores: { charisma: 18 } },
      actor: { type: "Character", characterId: casterEntityId },
      roster: {
        characters: [{ id: casterEntityId, name: "Malachar" }],
        monsters: [{ id: victimEntityId, name: "Shadow Construct" }],
        npcs: [],
      },
      encounter: { id: "enc-1", round: 1, turn: 0 },
      combatants: [casterCombatant, victimCombatant],
      actorCombatant: casterCombatant,
      characters: [
        { id: casterEntityId, name: "Malachar", sheet: { abilityScores: { charisma: 18 } } },
      ],
    } as any;

    await handler.handle(ctx);

    // The FINAL write to the caster (the bonusActionUsed patch) must preserve activeEffects.
    const casterWrites = updateCalls.filter((c) => c.id === casterCombatantId);
    const finalWrite = casterWrites[casterWrites.length - 1]!;
    const finalResources = finalWrite.body.resources as any;
    const finalEffects: any[] = finalResources?.activeEffects ?? [];
    expect(finalResources?.bonusActionUsed).toBe(true);
    const hexDamageEffect = finalEffects.find(
      (e) => e.source === "Hex" && e.target === "damage_rolls",
    );
    expect(hexDamageEffect, "Hex damage effect must survive the bonusActionUsed patch").toBeDefined();
    expect(hexDamageEffect.diceValue).toEqual({ count: 1, sides: 6 });
    expect(hexDamageEffect.targetCombatantId).toBe(victimEntityId);
  });
});
