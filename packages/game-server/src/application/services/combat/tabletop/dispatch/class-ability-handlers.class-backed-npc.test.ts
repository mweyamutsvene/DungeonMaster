/**
 * Tests for ClassAbilityHandlers with class-backed NPCs.
 *
 * Verifies that handleClassAbility correctly:
 *  1. Accepts a class-backed NPC actor (className + level + sheet) in place of a Character.
 *  2. Throws ValidationError when actor is a stat-block NPC (no class info).
 *  3. Routes ability execution using getClassBackedActorSource resolution.
 */

import { describe, expect, it, vi } from "vitest";
import { ClassAbilityHandlers } from "./class-ability-handlers.js";
import { AbilityRegistry } from "../../abilities/ability-registry.js";
import { TabletopEventEmitter } from "../tabletop-event-emitter.js";
import { ValidationError } from "../../../../errors.js";
import type { TabletopCombatServiceDeps } from "../tabletop-types.js";

// A minimal ability executor that immediately returns actionComplete=true
class NoopAbilityExecutor {
  readonly id = "class.fighter.noopAbility";
  readonly abilityId = "class.fighter.noopAbility";
  canExecute(id: string): boolean {
    return id === this.abilityId;
  }
  async execute(_ctx: any): Promise<any> {
    return {
      success: true,
      summary: "Noop ability used.",
      data: {},
    };
  }
}

function makeClassBackedNpc(overrides: Partial<any> = {}) {
  return {
    id: "npc-fighter-1",
    name: "Allied Fighter",
    statBlock: null,
    className: "Fighter",
    level: 5,
    sheet: {
      classId: "fighter",
      level: 5,
      maxHP: 44,
      currentHP: 44,
      speed: 30,
      abilityScores: {
        strength: 16,
        dexterity: 13,
        constitution: 15,
        intelligence: 10,
        wisdom: 11,
        charisma: 10,
      },
    },
    ...overrides,
  };
}

function makeStatBlockNpc(overrides: Partial<any> = {}) {
  return {
    id: "npc-guard-1",
    name: "Town Guard",
    statBlock: {
      maxHP: 15,
      currentHP: 15,
      armorClass: 14,
      speed: 30,
      abilityScores: {
        strength: 13,
        dexterity: 12,
        constitution: 12,
        intelligence: 10,
        wisdom: 10,
        charisma: 9,
      },
    },
    className: null,
    level: null,
    sheet: null,
    ...overrides,
  };
}

function makeNpcCombatant(npcId: string, overrides: Partial<any> = {}) {
  return {
    id: `cbt-${npcId}`,
    combatantType: "NPC",
    characterId: null,
    monsterId: null,
    npcId,
    hpCurrent: 44,
    hpMax: 44,
    resources: {
      resourcePools: [],
    },
    ...overrides,
  };
}

async function runClassAbility(opts: {
  actorId: string;
  abilityId: string;
  text: string;
  characters?: any[];
  npcs?: any[];
  combatants?: any[];
  monsters?: any[];
}) {
  const { actorId, abilityId, text, characters = [], npcs = [], combatants = [], monsters = [] } = opts;

  const updateCalls: { id: string; body: any }[] = [];

  const registry = new AbilityRegistry();
  registry.register(new NoopAbilityExecutor() as any);

  const deps = {
    combatRepo: {
      listCombatants: vi.fn().mockResolvedValue(combatants),
      updateCombatantState: vi.fn((id: string, body: any) => {
        updateCalls.push({ id, body });
        return Promise.resolve();
      }),
      getEncounterById: vi.fn().mockResolvedValue({ id: "enc-1", round: 1, turn: 0 }),
      setPendingAction: vi.fn().mockResolvedValue(undefined),
    },
    abilityRegistry: registry,
    actions: {} as any,
    twoPhaseActions: {} as any,
  } as unknown as TabletopCombatServiceDeps;

  const eventEmitter = new TabletopEventEmitter({} as any, null);
  const handler = new ClassAbilityHandlers(deps, eventEmitter, false);

  const roster = {
    characters: characters.map((c) => ({ id: c.id, name: c.name })),
    monsters: monsters.map((m) => ({ id: m.id, name: m.name })),
    npcs: npcs.map((n) => ({ id: n.id, name: n.name })),
  };

  const result = await handler.handleClassAbility(
    "sess-1",
    "enc-1",
    actorId,
    abilityId,
    characters,
    monsters,
    npcs,
    roster,
    text,
  );

  return { result, updateCalls };
}

describe("ClassAbilityHandlers — class-backed NPC support", () => {
  it("executes ability for class-backed NPC actor", async () => {
    const npc = makeClassBackedNpc();
    const npcCombatant = makeNpcCombatant(npc.id);

    const { result } = await runClassAbility({
      actorId: npc.id,
      abilityId: "class.fighter.noopAbility",
      text: "noop ability",
      npcs: [npc],
      combatants: [npcCombatant],
    });

    // Should succeed (actionComplete or at least not throw ValidationError)
    expect(result).toBeDefined();
    expect(result.actionComplete).toBe(true);
  });

  it("throws ValidationError for stat-block NPC (no className/sheet)", async () => {
    const npc = makeStatBlockNpc();
    const npcCombatant = makeNpcCombatant(npc.id, { hpCurrent: 15, hpMax: 15 });

    await expect(
      runClassAbility({
        actorId: npc.id,
        abilityId: "class.fighter.noopAbility",
        text: "noop ability",
        npcs: [npc],
        combatants: [npcCombatant],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("throws ValidationError when actor is not in any entity list", async () => {
    await expect(
      runClassAbility({
        actorId: "unknown-actor",
        abilityId: "class.fighter.noopAbility",
        text: "noop ability",
        characters: [],
        npcs: [],
        combatants: [],
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("resolves class-backed NPC className and level for ability execution", async () => {
    const npc = makeClassBackedNpc({ id: "npc-lvl3", level: 3, className: "Rogue" });
    const npcCombatant = makeNpcCombatant(npc.id);

    const { result } = await runClassAbility({
      actorId: npc.id,
      abilityId: "class.fighter.noopAbility",
      text: "noop ability",
      npcs: [npc],
      combatants: [npcCombatant],
    });

    expect(result).toBeDefined();
    expect(result.actionComplete).toBe(true);
  });
});
