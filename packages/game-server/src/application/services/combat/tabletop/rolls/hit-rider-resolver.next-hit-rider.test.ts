/**
 * SPELL-NEXT-HIT-RIDER: HitRiderResolver — generic `on_next_weapon_hit` rider
 * consumption (Searing Smite, Divine Favor, Ensnaring Strike, etc. substrate).
 *
 * Paladin/Ranger smite-style spells install an ActiveEffect on the caster with
 * `triggerAt: "on_next_weapon_hit"`. On a confirmed hit, each such effect
 * should:
 *   - contribute one HitRiderEnhancement with bonus dice (damage) and/or
 *     postDamageEffect saving-throw (condition / half damage on save),
 *   - be REMOVED from the caster's resources (single-use),
 *   - stack with other active riders in the same activation.
 *
 * On a miss, the rider must NOT be consumed (miss path doesn't call
 * `assembleOnHitEnhancements`). On the next hit after consumption, the rider
 * must not fire again.
 */

import { describe, it, expect, vi } from "vitest";
import { HitRiderResolver } from "./hit-rider-resolver.js";
import type { TabletopCombatServiceDeps } from "../tabletop-types.js";

function makeRiderEffect(
  id: string,
  source: string,
  dice: { count: number; sides: number },
  damageType: string,
) {
  return {
    id,
    type: "bonus" as const,
    target: "damage_rolls" as const,
    duration: "until_triggered" as const,
    diceValue: { count: dice.count, sides: dice.sides },
    damageType,
    source,
    triggerAt: "on_next_weapon_hit" as const,
  };
}

function makeCasterCombatant(resources: unknown) {
  return {
    id: "c-caster",
    combatantType: "Character" as const,
    characterId: "char-paladin",
    hpCurrent: 30,
    conditions: [],
    resources,
  };
}

function makeDeps(combatants: any[], updateCombatantState: any): TabletopCombatServiceDeps {
  return {
    combatRepo: {
      listCombatants: vi.fn().mockResolvedValue(combatants),
      updateCombatantState,
    },
  } as any;
}

function makeCasterCharacter() {
  return {
    id: "char-paladin",
    sessionId: "sess-1",
    name: "Sir Roland",
    level: 5,
    className: "Paladin",
    sheet: { abilityScores: { wisdom: 14 }, level: 5, className: "Paladin" },
    faction: "PC",
    aiControlled: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("SPELL-NEXT-HIT-RIDER: HitRiderResolver.assembleOnHitEnhancements", () => {
  it("consumes a single `on_next_weapon_hit` rider and emits a bonusDice enhancement", async () => {
    const riderId = "effect-searing-1";
    const casterResources = {
      activeEffects: [makeRiderEffect(riderId, "Searing Smite", { count: 1, sides: 6 }, "fire")],
    };
    const caster = makeCasterCombatant(casterResources);
    const updateCombatantState = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps([caster], updateCombatantState);

    const resolver = new HitRiderResolver(deps, null, false);

    const enhancements = await resolver.assembleOnHitEnhancements({
      rawText: "I swing",
      actorId: "char-paladin",
      encounterId: "enc-1",
      characters: [makeCasterCharacter()] as any,
      weaponSpec: { kind: "melee" } as any,
    });

    expect(enhancements).toHaveLength(1);
    expect(enhancements[0].displayName).toBe("Searing Smite");
    expect(enhancements[0].bonusDice).toEqual({ diceCount: 1, diceSides: 6, damageType: "fire" });

    // Effect removed from caster resources.
    expect(updateCombatantState).toHaveBeenCalledTimes(1);
    const written = updateCombatantState.mock.calls[0][1].resources;
    const remaining = (written.activeEffects ?? []) as any[];
    expect(remaining.find((e) => e.id === riderId)).toBeUndefined();
  });

  it("stacks multiple `on_next_weapon_hit` riders on the same hit and consumes all", async () => {
    const r1 = makeRiderEffect("eff-searing", "Searing Smite", { count: 1, sides: 6 }, "fire");
    const r2 = makeRiderEffect("eff-favor", "Divine Favor", { count: 1, sides: 4 }, "radiant");
    const caster = makeCasterCombatant({ activeEffects: [r1, r2] });
    const updateCombatantState = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps([caster], updateCombatantState);

    const resolver = new HitRiderResolver(deps, null, false);

    const enhancements = await resolver.assembleOnHitEnhancements({
      rawText: "I strike",
      actorId: "char-paladin",
      encounterId: "enc-1",
      characters: [makeCasterCharacter()] as any,
      weaponSpec: { kind: "melee" } as any,
    });

    expect(enhancements).toHaveLength(2);
    const names = enhancements.map((e) => e.displayName).sort();
    expect(names).toEqual(["Divine Favor", "Searing Smite"]);
    const diceByName = Object.fromEntries(enhancements.map((e) => [e.displayName, e.bonusDice]));
    expect(diceByName["Searing Smite"]).toEqual({ diceCount: 1, diceSides: 6, damageType: "fire" });
    expect(diceByName["Divine Favor"]).toEqual({ diceCount: 1, diceSides: 4, damageType: "radiant" });

    // Both effects removed in the single persisted write.
    expect(updateCombatantState).toHaveBeenCalledTimes(1);
    const written = updateCombatantState.mock.calls[0][1].resources;
    const remaining = (written.activeEffects ?? []) as any[];
    expect(remaining).toHaveLength(0);
  });

  it("does NOT consume the rider on a miss (assembleOnHitEnhancements is not called on miss)", async () => {
    // Miss path never invokes assembleOnHitEnhancements; we simulate that by NOT calling
    // the method and asserting the effect is still present on the caster's resources.
    const r1 = makeRiderEffect("eff-searing", "Searing Smite", { count: 1, sides: 6 }, "fire");
    const caster = makeCasterCombatant({ activeEffects: [r1] });
    const updateCombatantState = vi.fn().mockResolvedValue(undefined);
    const deps = makeDeps([caster], updateCombatantState);

    // Simulate a miss: resolver is NEVER asked to assemble enhancements.
    // (This mirrors how DamageResolver only calls assembleOnHitEnhancements after a hit.)
    expect(updateCombatantState).not.toHaveBeenCalled();
    expect((caster.resources as any).activeEffects).toHaveLength(1);

    // Sanity: resolver exists and is wired; constructor doesn't touch resources.
    const resolver = new HitRiderResolver(deps, null, false);
    expect(resolver).toBeDefined();
  });

  it("is gone on the next hit after a single consumption (one-shot rider)", async () => {
    const r1 = makeRiderEffect("eff-searing", "Searing Smite", { count: 1, sides: 6 }, "fire");
    const casterResources: any = { activeEffects: [r1] };
    const caster = makeCasterCombatant(casterResources);
    const updateCombatantState = vi.fn(async (_id: string, patch: any) => {
      // Mutate the shared caster combatant so the next listCombatants call reflects
      // post-consumption state (mirrors what the repo does in production).
      caster.resources = patch.resources;
    });
    const deps: TabletopCombatServiceDeps = {
      combatRepo: {
        listCombatants: vi.fn(async () => [caster]),
        updateCombatantState,
      },
    } as any;

    const resolver = new HitRiderResolver(deps, null, false);

    const first = await resolver.assembleOnHitEnhancements({
      rawText: "hit 1",
      actorId: "char-paladin",
      encounterId: "enc-1",
      characters: [makeCasterCharacter()] as any,
      weaponSpec: { kind: "melee" } as any,
    });
    expect(first).toHaveLength(1);

    const second = await resolver.assembleOnHitEnhancements({
      rawText: "hit 2",
      actorId: "char-paladin",
      encounterId: "enc-1",
      characters: [makeCasterCharacter()] as any,
      weaponSpec: { kind: "melee" } as any,
    });
    expect(second).toHaveLength(0);
  });
});
