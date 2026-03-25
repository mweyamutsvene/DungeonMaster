/**
 * Unit tests for DeterministicAiDecisionMaker.
 */
import { describe, it, expect } from "vitest";
import { DeterministicAiDecisionMaker } from "./deterministic-ai.js";
import type { AiCombatContext } from "./ai-types.js";

type EnemyEntry = AiCombatContext["enemies"][number];
type CombatantEntry = AiCombatContext["combatant"];

function makeEnemy(overrides: Partial<EnemyEntry> & { name: string }): EnemyEntry {
  return {
    hp: { current: 50, max: 100, percentage: 50 },
    initiative: 10,
    ...overrides,
  };
}

function makeCombatant(overrides: Partial<CombatantEntry> = {}): CombatantEntry {
  return {
    name: "Goblin",
    hp: { current: 30, max: 30, percentage: 100 },
    position: { x: 0, y: 0 },
    economy: {
      actionSpent: false,
      bonusActionSpent: false,
      reactionSpent: false,
      movementSpent: false,
    },
    ac: 15,
    speed: 30,
    attacks: [
      { name: "Scimitar", toHit: 4, damage: "1d6+2", kind: "melee" },
    ],
    traits: [],
    actions: [],
    bonusActions: [],
    reactions: [],
    spells: [],
    abilities: [],
    features: [],
    initiative: 15,
    ...overrides,
  };
}

function makeContext(overrides: Partial<AiCombatContext> = {}): AiCombatContext {
  return {
    combatant: makeCombatant(),
    combat: { round: 1, turn: 0, totalCombatants: 2 },
    allies: [],
    enemies: [makeEnemy({ name: "Fighter", position: { x: 1, y: 0 }, distanceFeet: 5 })],
    hasPotions: false,
    recentNarrative: [],
    actionHistory: [],
    turnResults: [],
    lastActionResult: null,
    ...overrides,
  };
}

describe("DeterministicAiDecisionMaker", () => {
  const ai = new DeterministicAiDecisionMaker();

  it("stands up from prone as first action", async () => {
    const ctx = makeContext({
      combatant: makeCombatant({
        conditions: ["Prone"],
        position: { x: 3, y: 3 },
      }),
    });

    const decision = await ai.decide({
      combatantName: "Goblin",
      combatantType: "Monster",
      context: ctx,
    });

    expect(decision).not.toBeNull();
    expect(decision!.action).toBe("move");
    expect(decision!.destination).toEqual({ x: 3, y: 3 });
    expect(decision!.endTurn).toBe(false);
  });

  it("does not stand if already moved (movement spent)", async () => {
    const ctx = makeContext({
      combatant: makeCombatant({
        conditions: ["Prone"],
        position: { x: 3, y: 3 },
        economy: {
          actionSpent: false,
          bonusActionSpent: false,
          reactionSpent: false,
          movementSpent: true,
        },
      }),
    });

    const decision = await ai.decide({
      combatantName: "Goblin",
      combatantType: "Monster",
      context: ctx,
    });

    // Should skip standing up since movement already spent, go straight to attack
    expect(decision).not.toBeNull();
    expect(decision!.action).not.toBe("move");
  });

  it("moves toward nearest enemy when out of melee range", async () => {
    const ctx = makeContext({
      enemies: [makeEnemy({ name: "Fighter", position: { x: 5, y: 0 }, distanceFeet: 25 })],
    });

    const decision = await ai.decide({
      combatantName: "Goblin",
      combatantType: "Monster",
      context: ctx,
    });

    expect(decision).not.toBeNull();
    expect(decision!.action).toBe("moveToward");
    expect(decision!.target).toBe("Fighter");
    expect(decision!.desiredRange).toBe(5);
    expect(decision!.endTurn).toBe(false);
  });

  it("attacks nearest target when in melee range", async () => {
    const ctx = makeContext({
      enemies: [makeEnemy({ name: "Fighter", position: { x: 1, y: 0 }, distanceFeet: 5 })],
    });

    const decision = await ai.decide({
      combatantName: "Goblin",
      combatantType: "Monster",
      context: ctx,
    });

    expect(decision).not.toBeNull();
    expect(decision!.action).toBe("attack");
    expect(decision!.target).toBe("Fighter");
    expect(decision!.attackName).toBe("Scimitar");
  });

  it("ends turn when no enemies remain", async () => {
    const ctx = makeContext({ enemies: [] });

    const decision = await ai.decide({
      combatantName: "Goblin",
      combatantType: "Monster",
      context: ctx,
    });

    expect(decision).not.toBeNull();
    expect(decision!.action).toBe("endTurn");
  });

  it("ends turn when all enemies are dead", async () => {
    const ctx = makeContext({
      enemies: [makeEnemy({ name: "Fighter", hp: { current: 0, max: 50, percentage: 0 } })],
    });

    const decision = await ai.decide({
      combatantName: "Goblin",
      combatantType: "Monster",
      context: ctx,
    });

    expect(decision!.action).toBe("endTurn");
  });

  it("uses bonus action (Second Wind) when low HP fighter", async () => {
    const ctx = makeContext({
      combatant: makeCombatant({
        name: "Fighter",
        hp: { current: 15, max: 40, percentage: 37 },
        classAbilities: [{ name: "Second Wind", economy: "bonus" }],
        resourcePools: [{ name: "secondWind", current: 1, max: 1 }],
      }),
      enemies: [makeEnemy({ name: "Goblin", position: { x: 1, y: 0 }, distanceFeet: 5 })],
    });

    const decision = await ai.decide({
      combatantName: "Fighter",
      combatantType: "Character",
      context: ctx,
    });

    expect(decision!.action).toBe("attack");
    expect(decision!.bonusAction).toBe("secondWind");
  });

  it("uses Flurry of Blows when monk has ki", async () => {
    const ctx = makeContext({
      combatant: makeCombatant({
        name: "Monk",
        class: "monk",
        classAbilities: [{ name: "Flurry of Blows", economy: "bonus", resourceCost: "1 ki" }],
        resourcePools: [{ name: "ki", current: 3, max: 4 }],
        attacks: [{ name: "Unarmed Strike", toHit: 5, damage: "1d6+3", kind: "melee" }],
      }),
      enemies: [makeEnemy({ name: "Goblin", position: { x: 1, y: 0 }, distanceFeet: 5 })],
    });

    const decision = await ai.decide({
      combatantName: "Monk",
      combatantType: "Character",
      context: ctx,
    });

    expect(decision!.action).toBe("attack");
    expect(decision!.bonusAction).toBe("flurryOfBlows");
  });

  it("handles ranged creature — moves away when too close", async () => {
    const ctx = makeContext({
      combatant: makeCombatant({
        name: "Archer",
        attacks: [{ name: "Longbow", toHit: 5, damage: "1d8+3", kind: "ranged" }],
      }),
      enemies: [makeEnemy({ name: "Fighter", position: { x: 1, y: 0 }, distanceFeet: 5 })],
    });

    const decision = await ai.decide({
      combatantName: "Archer",
      combatantType: "Monster",
      context: ctx,
    });

    expect(decision!.action).toBe("moveAwayFrom");
    expect(decision!.target).toBe("Fighter");
    expect(decision!.endTurn).toBe(false);
  });

  it("ranged creature attacks at good range without moving", async () => {
    const ctx = makeContext({
      combatant: makeCombatant({
        name: "Archer",
        attacks: [{ name: "Longbow", toHit: 5, damage: "1d8+3", kind: "ranged" }],
      }),
      enemies: [makeEnemy({ name: "Fighter", position: { x: 6, y: 0 }, distanceFeet: 30 })],
    });

    const decision = await ai.decide({
      combatantName: "Archer",
      combatantType: "Monster",
      context: ctx,
    });

    expect(decision!.action).toBe("attack");
    expect(decision!.target).toBe("Fighter");
    expect(decision!.attackName).toBe("Longbow");
  });

  it("dashes when no attacks available but enemies exist", async () => {
    const ctx = makeContext({
      combatant: makeCombatant({
        name: "Zombie",
        attacks: [],
      }),
      enemies: [makeEnemy({ name: "Fighter", position: { x: 1, y: 0 }, distanceFeet: 5 })],
    });

    const decision = await ai.decide({
      combatantName: "Zombie",
      combatantType: "Monster",
      context: ctx,
    });

    expect(decision!.action).toBe("dash");
  });

  it("retreats when low HP and outnumbered", async () => {
    const ctx = makeContext({
      combatant: makeCombatant({
        hp: { current: 5, max: 30, percentage: 16 },
        economy: {
          actionSpent: true,
          bonusActionSpent: true,
          reactionSpent: false,
          movementSpent: false,
        },
      }),
      enemies: [
        makeEnemy({ name: "Fighter", position: { x: 1, y: 0 }, distanceFeet: 5 }),
        makeEnemy({ name: "Rogue", position: { x: 0, y: 1 }, distanceFeet: 5 }),
      ],
    });

    const decision = await ai.decide({
      combatantName: "Goblin",
      combatantType: "Monster",
      context: ctx,
    });

    expect(decision!.action).toBe("moveAwayFrom");
  });

  it("drinks healing potion when low HP and potion available", async () => {
    const ctx = makeContext({
      combatant: makeCombatant({
        hp: { current: 8, max: 30, percentage: 26 },
        attacks: [],
      }),
      enemies: [makeEnemy({ name: "Fighter", position: { x: 1, y: 0 }, distanceFeet: 5 })],
      hasPotions: true,
    });

    const decision = await ai.decide({
      combatantName: "Goblin",
      combatantType: "Monster",
      context: ctx,
    });

    expect(decision!.action).toBe("useObject");
  });

  it("returns endTurn for null context", async () => {
    const decision = await ai.decide({
      combatantName: "Goblin",
      combatantType: "Monster",
      context: undefined as unknown,
    });

    expect(decision).not.toBeNull();
    expect(decision!.action).toBe("endTurn");
  });

  it("targets concentration caster over full-HP enemy", async () => {
    const ctx = makeContext({
      enemies: [
        makeEnemy({
          name: "Fighter",
          hp: { current: 60, max: 60, percentage: 100 },
          position: { x: 1, y: 0 },
          distanceFeet: 5,
        }),
        makeEnemy({
          name: "Wizard",
          hp: { current: 25, max: 30, percentage: 83 },
          concentrationSpell: "Spirit Guardians",
          position: { x: 1, y: 0 },
          distanceFeet: 5,
        }),
      ],
    });

    const decision = await ai.decide({
      combatantName: "Goblin",
      combatantType: "Monster",
      context: ctx,
    });

    expect(decision!.action).toBe("attack");
    // Wizard should be scored higher due to concentration + lower HP
    expect(decision!.target).toBe("Wizard");
  });

  it("uses Rage as bonus action at start of combat for barbarian", async () => {
    const ctx = makeContext({
      combatant: makeCombatant({
        name: "Barbarian",
        class: "barbarian",
        classAbilities: [{ name: "Rage", economy: "bonus" }],
        resourcePools: [{ name: "rage", current: 3, max: 3 }],
        attacks: [{ name: "Greataxe", toHit: 5, damage: "1d12+3", kind: "melee" }],
      }),
      enemies: [makeEnemy({ name: "Goblin", position: { x: 1, y: 0 }, distanceFeet: 5 })],
    });

    const decision = await ai.decide({
      combatantName: "Barbarian",
      combatantType: "Character",
      context: ctx,
    });

    expect(decision!.action).toBe("attack");
    expect(decision!.bonusAction).toBe("rage");
  });
});
