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

  // ── AI-M3: Disengage-before-retreat ──────────────────────────
  describe("disengage before retreat", () => {
    it("uses Disengage action before retreating when low HP and adjacent enemies", async () => {
      const ctx = makeContext({
        combatant: makeCombatant({
          hp: { current: 5, max: 30, percentage: 16 },
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

      expect(decision!.action).toBe("disengage");
      expect(decision!.endTurn).toBe(false);
    });

    it("uses Cunning Action disengage as bonus action for rogue retreat", async () => {
      const ctx = makeContext({
        combatant: makeCombatant({
          hp: { current: 5, max: 30, percentage: 16 },
          classAbilities: [{ name: "Cunning Action", economy: "bonus" }],
        }),
        enemies: [
          makeEnemy({ name: "Fighter", position: { x: 1, y: 0 }, distanceFeet: 5 }),
          makeEnemy({ name: "Wizard", position: { x: 0, y: 1 }, distanceFeet: 5 }),
        ],
      });

      const decision = await ai.decide({
        combatantName: "Rogue",
        combatantType: "Character",
        context: ctx,
      });

      // Should use bonus action disengage (preserving main action)
      expect(decision!.action).toBe("endTurn");
      expect(decision!.bonusAction).toBe("cunningAction:disengage");
      expect(decision!.endTurn).toBe(false);
    });

    it("uses Nimble Escape disengage for goblin retreat", async () => {
      const ctx = makeContext({
        combatant: makeCombatant({
          hp: { current: 5, max: 30, percentage: 16 },
          bonusActions: [{ name: "Nimble Escape" }],
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

      expect(decision!.action).toBe("endTurn");
      expect(decision!.bonusAction).toBe("nimble_escape_disengage");
      expect(decision!.endTurn).toBe(false);
    });

    it("does not disengage when no adjacent enemies", async () => {
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
          makeEnemy({ name: "Fighter", position: { x: 5, y: 0 }, distanceFeet: 25 }),
          makeEnemy({ name: "Rogue", position: { x: 0, y: 5 }, distanceFeet: 25 }),
        ],
      });

      const decision = await ai.decide({
        combatantName: "Goblin",
        combatantType: "Monster",
        context: ctx,
      });

      // Enemies at 25ft are not adjacent — no disengage needed.
      // Creature still moves toward target (step 3) since movement isn't spent.
      expect(decision!.action).not.toBe("disengage");
      expect(decision!.bonusAction).toBeUndefined();
    });

    it("uses bonus disengage in step 8 when action spent but bonus available", async () => {
      const ctx = makeContext({
        combatant: makeCombatant({
          hp: { current: 5, max: 30, percentage: 16 },
          classAbilities: [{ name: "Cunning Action", economy: "bonus" }],
          economy: {
            actionSpent: true,
            bonusActionSpent: false,
            reactionSpent: false,
            movementSpent: false,
          },
        }),
        enemies: [
          makeEnemy({ name: "Fighter", position: { x: 1, y: 0 }, distanceFeet: 5 }),
          makeEnemy({ name: "Wizard", position: { x: 0, y: 1 }, distanceFeet: 5 }),
        ],
      });

      const decision = await ai.decide({
        combatantName: "Rogue",
        combatantType: "Character",
        context: ctx,
      });

      // Should use bonus disengage first (then moveAwayFrom on next iteration)
      expect(decision!.action).toBe("endTurn");
      expect(decision!.bonusAction).toBe("cunningAction:disengage");
      expect(decision!.endTurn).toBe(false);
    });
  });

  // ── AI-M4: Triage for dying allies ───────────────────────────
  describe("triage for dying allies", () => {
    it("heals dying ally with healing spell before attacking", async () => {
      const ctx = makeContext({
        combatant: makeCombatant({
          name: "Cleric",
          spells: [
            { name: "Cure Wounds", level: 1, healing: { diceCount: 1, diceSides: 8, modifier: 3 } },
          ],
          resourcePools: [{ name: "spellSlot_1", current: 2, max: 2 }],
        }),
        allies: [
          {
            name: "Fighter",
            hp: { current: 0, max: 50, percentage: 0 },
            initiative: 10,
            deathSaves: { successes: 0, failures: 1 },
          },
        ],
        enemies: [makeEnemy({ name: "Goblin", position: { x: 1, y: 0 }, distanceFeet: 5 })],
      });

      const decision = await ai.decide({
        combatantName: "Cleric",
        combatantType: "Character",
        context: ctx,
      });

      expect(decision!.action).toBe("castSpell");
      expect(decision!.spellName).toBe("Cure Wounds");
      expect(decision!.target).toBe("Fighter");
    });

    it("prefers bonus-action heal (Healing Word) for dying ally", async () => {
      const ctx = makeContext({
        combatant: makeCombatant({
          name: "Cleric",
          spells: [
            { name: "Cure Wounds", level: 1, healing: { diceCount: 1, diceSides: 8, modifier: 3 } },
            { name: "Healing Word", level: 1, healing: { diceCount: 1, diceSides: 4, modifier: 3 }, isBonusAction: true },
          ],
          resourcePools: [{ name: "spellSlot_1", current: 2, max: 2 }],
        }),
        allies: [
          {
            name: "Fighter",
            hp: { current: 0, max: 50, percentage: 0 },
            initiative: 10,
            deathSaves: { successes: 0, failures: 2 },
          },
        ],
        enemies: [makeEnemy({ name: "Goblin", position: { x: 1, y: 0 }, distanceFeet: 5 })],
      });

      const decision = await ai.decide({
        combatantName: "Cleric",
        combatantType: "Character",
        context: ctx,
      });

      expect(decision!.action).toBe("castSpell");
      expect(decision!.spellName).toBe("Healing Word");
      expect(decision!.target).toBe("Fighter");
      // Bonus action spell should not end the turn
      expect(decision!.endTurn).toBe(false);
    });

    it("uses Lay on Hands on dying ally", async () => {
      const ctx = makeContext({
        combatant: makeCombatant({
          name: "Paladin",
          classAbilities: [{ name: "Lay on Hands", economy: "action" }],
          resourcePools: [{ name: "layonhands", current: 25, max: 25 }],
        }),
        allies: [
          {
            name: "Fighter",
            hp: { current: 0, max: 50, percentage: 0 },
            initiative: 10,
            deathSaves: { successes: 1, failures: 1 },
          },
        ],
        enemies: [makeEnemy({ name: "Goblin", position: { x: 1, y: 0 }, distanceFeet: 5 })],
      });

      const decision = await ai.decide({
        combatantName: "Paladin",
        combatantType: "Character",
        context: ctx,
      });

      expect(decision!.action).toBe("useFeature");
      expect(decision!.featureId).toBe("layOnHands");
      expect(decision!.target).toBe("Fighter");
    });

    it("does not attempt triage when no healing available", async () => {
      const ctx = makeContext({
        combatant: makeCombatant({
          name: "Fighter",
        }),
        allies: [
          {
            name: "Wizard",
            hp: { current: 0, max: 30, percentage: 0 },
            initiative: 10,
            deathSaves: { successes: 0, failures: 1 },
          },
        ],
        enemies: [makeEnemy({ name: "Goblin", position: { x: 1, y: 0 }, distanceFeet: 5 })],
      });

      const decision = await ai.decide({
        combatantName: "Fighter",
        combatantType: "Character",
        context: ctx,
      });

      // Should attack since no healing available
      expect(decision!.action).toBe("attack");
    });

    it("does not triage stabilized allies (3 successes)", async () => {
      const ctx = makeContext({
        combatant: makeCombatant({
          name: "Cleric",
          spells: [
            { name: "Cure Wounds", level: 1, healing: { diceCount: 1, diceSides: 8, modifier: 3 } },
          ],
          resourcePools: [{ name: "spellSlot_1", current: 2, max: 2 }],
        }),
        allies: [
          {
            name: "Fighter",
            hp: { current: 0, max: 50, percentage: 0 },
            initiative: 10,
            deathSaves: { successes: 3, failures: 0 },
          },
        ],
        enemies: [makeEnemy({ name: "Goblin", position: { x: 1, y: 0 }, distanceFeet: 5 })],
      });

      const decision = await ai.decide({
        combatantName: "Cleric",
        combatantType: "Character",
        context: ctx,
      });

      // Should attack since ally is stabilized (3 successes)
      expect(decision!.action).toBe("attack");
    });
  });

  // ── AI-M8: Re-evaluate targets between Extra Attack swings ───
  describe("re-evaluate targets between Extra Attack swings", () => {
    it("switches target if previous attack hit the primary target", async () => {
      const ctx = makeContext({
        combatant: makeCombatant({
          attacksPerAction: 2,
        }),
        enemies: [
          makeEnemy({ name: "Goblin1", position: { x: 1, y: 0 }, distanceFeet: 5, hp: { current: 20, max: 20, percentage: 100 } }),
          makeEnemy({ name: "Goblin2", position: { x: 0, y: 1 }, distanceFeet: 5, hp: { current: 20, max: 20, percentage: 100 } }),
        ],
        turnResults: [
          {
            step: 1,
            action: "attack" as const,
            ok: true,
            summary: "Attack hit Goblin1 for 10 damage",
            data: { hit: true, damage: 10, target: "Goblin1", attackName: "Scimitar" },
          },
        ],
      });

      const decision = await ai.decide({
        combatantName: "Fighter",
        combatantType: "Character",
        context: ctx,
      });

      // Should re-evaluate: since previous attack hit Goblin1, pick Goblin2
      // (Note: Goblin1 is still alive in enemies list since context wasn't refreshed in this test,
      // but the re-evaluation heuristic checks if the last attack hit the primary target)
      expect(decision!.action).toBe("attack");
      expect(decision!.target).toBe("Goblin2");
    });

    it("keeps same target if previous attack missed", async () => {
      const ctx = makeContext({
        combatant: makeCombatant({
          attacksPerAction: 2,
        }),
        enemies: [
          makeEnemy({ name: "Goblin1", position: { x: 1, y: 0 }, distanceFeet: 5, hp: { current: 10, max: 20, percentage: 50 } }),
          makeEnemy({ name: "Goblin2", position: { x: 0, y: 1 }, distanceFeet: 5, hp: { current: 20, max: 20, percentage: 100 } }),
        ],
        turnResults: [
          {
            step: 1,
            action: "attack" as const,
            ok: true,
            summary: "Attack missed Goblin1",
            data: { hit: false, damage: 0, target: "Goblin1", attackName: "Scimitar" },
          },
        ],
      });

      const decision = await ai.decide({
        combatantName: "Fighter",
        combatantType: "Character",
        context: ctx,
      });

      // Should keep Goblin1 (scored higher due to lower HP) since attack missed
      expect(decision!.action).toBe("attack");
      expect(decision!.target).toBe("Goblin1");
    });
  });
});
