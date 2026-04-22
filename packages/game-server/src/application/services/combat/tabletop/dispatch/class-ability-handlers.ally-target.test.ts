/**
 * Lock-in test for GAP-10: Lay on Hands ally targeting via text dispatcher.
 *
 * Verifies that ClassAbilityHandlers.handleBonusAbility correctly:
 *  1. Resolves an ally Character when the text names a party member
 *     (executor's `allowsAllyTarget === true` is honoured).
 *  2. Falls through to self-heal when no target is named.
 *  3. Does NOT resolve to a monster name — ally-target abilities must never
 *     heal hostile creatures even when the monster name appears in the text.
 *  4. Passes `targetEntityId` (not `targetId`) in params so the executor's
 *     `params.targetEntityId` read site works.
 *  5. Routes the resulting HP update to the ally combatant, not the caster.
 */

import { describe, expect, it, beforeEach, vi } from "vitest";
import { ClassAbilityHandlers } from "./class-ability-handlers.js";
import { AbilityRegistry } from "../../abilities/ability-registry.js";
import { LayOnHandsExecutor } from "../../abilities/executors/paladin/lay-on-hands-executor.js";
import { TabletopEventEmitter } from "../tabletop-event-emitter.js";
import type { TabletopCombatServiceDeps } from "../tabletop-types.js";

type UpdateCall = { id: string; body: { resources?: any; hpCurrent?: number } };

function makeCharacter(overrides: Partial<any> = {}) {
  return {
    id: "char-paladin",
    name: "Aria",
    className: "Paladin",
    level: 5,
    sheet: {
      className: "Paladin",
      classId: "paladin",
      level: 5,
      maxHp: 44,
      currentHp: 44,
      speed: 30,
      abilityScores: { strength: 16, dexterity: 10, constitution: 14, intelligence: 10, wisdom: 12, charisma: 16 },
    },
    ...overrides,
  };
}

function makeCombatant(overrides: Partial<any> = {}) {
  return {
    id: "cbt-paladin",
    combatantType: "Character",
    characterId: "char-paladin",
    hpCurrent: 44,
    hpMax: 44,
    resources: {
      resourcePools: [{ name: "layOnHands", current: 25, max: 25 }],
    },
    ...overrides,
  };
}

async function runHandler(opts: {
  text: string;
  characters: any[];
  combatants: any[];
  monsters?: any[];
}) {
  const { text, characters, combatants, monsters = [] } = opts;

  const updateCalls: UpdateCall[] = [];

  const registry = new AbilityRegistry();
  registry.register(new LayOnHandsExecutor());

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

  // Event emitter with no LLM (generateNarration returns undefined)
  const eventEmitter = new TabletopEventEmitter({} as any, null);

  const handler = new ClassAbilityHandlers(deps, eventEmitter, false);

  // Build LlmRoster for inferActorRef (object form: { characters, monsters, npcs })
  const roster = {
    characters: characters.map((c) => ({ id: c.id, name: c.name })),
    monsters: monsters.map((m) => ({ id: m.id, name: m.name })),
    npcs: [] as Array<{ id: string; name: string }>,
  };

  const result = await handler.handleBonusAbility(
    "sess-1",
    "enc-1",
    "char-paladin",
    "class.paladin.layOnHands",
    text,
    characters,
    monsters,
    [],
    roster,
  );

  return { result, updateCalls };
}

describe("GAP-10: Lay on Hands ally targeting via text dispatcher", () => {
  let paladin: any;
  let fighter: any;
  let paladinCombatant: any;
  let fighterCombatant: any;

  beforeEach(() => {
    paladin = makeCharacter();
    fighter = {
      id: "char-fighter",
      name: "Brond",
      className: "Fighter",
      level: 3,
      sheet: {
        className: "Fighter",
        classId: "fighter",
        level: 3,
        maxHp: 30,
        currentHp: 10, // Wounded, needs healing
        speed: 30,
        abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 8, wisdom: 10, charisma: 8 },
      },
    };
    paladinCombatant = makeCombatant();
    fighterCombatant = {
      id: "cbt-fighter",
      combatantType: "Character",
      characterId: "char-fighter",
      hpCurrent: 10,
      hpMax: 30,
      resources: {},
    };
  });

  it("`lay on hands Brond 5` heals the ally Fighter 5 HP and spends from the caster's pool", async () => {
    const { result, updateCalls } = await runHandler({
      text: "lay on hands Brond 5",
      characters: [paladin, fighter],
      combatants: [paladinCombatant, fighterCombatant],
    });

    expect(result.actionComplete).toBe(true);

    // The ally (fighter) combatant must receive an hpCurrent update to 10+5 = 15.
    const fighterHpWrite = updateCalls.find(
      (c) => c.id === "cbt-fighter" && typeof c.body.hpCurrent === "number",
    );
    expect(fighterHpWrite, "ally combatant must receive hpCurrent update").toBeDefined();
    expect(fighterHpWrite!.body.hpCurrent).toBe(15);

    // The paladin's resources must NOT be written with a hpCurrent (HP stays on fighter).
    const paladinResourceWrite = updateCalls.find(
      (c) => c.id === "cbt-paladin" && c.body.resources !== undefined,
    );
    expect(paladinResourceWrite).toBeDefined();
    expect(paladinResourceWrite!.body.hpCurrent).toBeUndefined();

    // Pool was decremented by 5 (25 → 20) on the paladin's resources.
    const pools = (paladinResourceWrite!.body.resources as any)?.resourcePools ?? [];
    const loh = pools.find((p: any) => p.name === "layOnHands");
    expect(loh?.current).toBe(20);

    // Bonus action marked used on paladin.
    expect((paladinResourceWrite!.body.resources as any)?.bonusActionUsed).toBe(true);
  });

  it("`lay on hands` (no target) heals the paladin herself (self-fallback preserved)", async () => {
    // Wound the paladin so healing has something to do.
    paladin.sheet.currentHp = 20;
    paladinCombatant = makeCombatant({ hpCurrent: 20 });

    const { result, updateCalls } = await runHandler({
      text: "lay on hands 10",
      characters: [paladin, fighter],
      combatants: [paladinCombatant, fighterCombatant],
    });

    expect(result.actionComplete).toBe(true);

    // Only the paladin should be updated.
    const paladinWrites = updateCalls.filter((c) => c.id === "cbt-paladin");
    const fighterWrites = updateCalls.filter((c) => c.id === "cbt-fighter");
    expect(fighterWrites.length).toBe(0);

    // HP update applied to paladin (20 + 10 = 30).
    const paladinHpWrite = paladinWrites.find((c) => typeof c.body.hpCurrent === "number");
    expect(paladinHpWrite).toBeDefined();
    expect(paladinHpWrite!.body.hpCurrent).toBe(30);
  });

  it("`lay on hands Goblin` is rejected (monster is not an ally)", async () => {
    const goblin = { id: "monster-goblin-1", name: "Goblin" };
    const goblinCombatant = {
      id: "cbt-goblin",
      combatantType: "Monster",
      monsterId: "monster-goblin-1",
      hpCurrent: 7,
      hpMax: 7,
      resources: {},
    };

    // Wound paladin so self-fallback would succeed if the dispatcher wrongly falls through.
    paladin.sheet.currentHp = 20;
    paladinCombatant = makeCombatant({ hpCurrent: 20 });

    const { updateCalls } = await runHandler({
      text: "lay on hands Goblin 10",
      characters: [paladin, fighter],
      combatants: [paladinCombatant, fighterCombatant, goblinCombatant],
      monsters: [goblin],
    });

    // The goblin must NEVER receive hpCurrent (no healing a hostile).
    const goblinWrites = updateCalls.filter((c) => c.id === "cbt-goblin");
    const goblinHpWrites = goblinWrites.filter((c) => typeof c.body.hpCurrent === "number");
    expect(goblinHpWrites.length).toBe(0);
  });
});
