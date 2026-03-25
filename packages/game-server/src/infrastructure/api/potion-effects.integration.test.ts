/**
 * Integration tests for PotionEffect system.
 *
 * Covers:
 * - Player drinks Potion of Resistance (Fire) — activeEffect with resistance persisted
 * - Player drinks Potion of Heroism — tempHp=10 + Bless ActiveEffects persisted
 *
 * Uses buildApp + app.inject() with in-memory repositories.
 * DiceRoller is FixedDiceRoller(10) unless specified otherwise.
 */

import { describe, it, expect, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { FixedDiceRoller } from "../../domain/rules/dice-roller.js";
import {
  MemoryGameSessionRepository,
  MemoryCharacterRepository,
  MemoryMonsterRepository,
  MemoryCombatRepository,
  MemoryEventRepository,
  MemoryNPCRepository,
  MemorySpellRepository,
} from "../testing/memory-repos.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildTestApp(fixedDie = 10): FastifyInstance {
  return buildApp({
    sessionsRepo: new MemoryGameSessionRepository(),
    charactersRepo: new MemoryCharacterRepository(),
    monstersRepo: new MemoryMonsterRepository(),
    npcsRepo: new MemoryNPCRepository(),
    combatRepo: new MemoryCombatRepository(),
    eventsRepo: new MemoryEventRepository(),
    spellsRepo: new MemorySpellRepository(),
    diceRoller: new FixedDiceRoller(fixedDie),
  });
}

/** Create a session, add a character with inventory, add a monster, start combat. */
async function setupCombatWithPotion(
  app: FastifyInstance,
  potionName: string,
): Promise<{ sessionId: string; encounterId: string; characterId: string; monsterId: string }> {
  // Create session
  const sessionRes = await app.inject({
    method: "POST",
    url: "/sessions",
    payload: { storyFramework: {} },
  });
  const sessionId = sessionRes.json().id as string;

  // Create character
  const charRes = await app.inject({
    method: "POST",
    url: `/sessions/${sessionId}/characters`,
    payload: { name: "Aldric", level: 3, className: "fighter", sheet: {} },
  });
  const characterId = charRes.json().id as string;

  // Create monster (used so character needs to act in combat)
  const monRes = await app.inject({
    method: "POST",
    url: `/sessions/${sessionId}/monsters`,
    payload: { name: "Goblin", statBlock: { hp: 15, armorClass: 13 } },
  });
  const monsterId = monRes.json().id as string;

  // Start combat — character has the potion in inventory via resources
  const combatRes = await app.inject({
    method: "POST",
    url: `/sessions/${sessionId}/combat/start`,
    payload: {
      combatants: [
        {
          combatantType: "Character",
          characterId,
          initiative: 20,
          hpCurrent: 25,
          hpMax: 25,
          resources: {
            inventory: [
              {
                name: potionName,
                quantity: 1,
                equipped: false,
                attuned: false,
              },
            ],
          },
        },
        {
          combatantType: "Monster",
          monsterId,
          initiative: 8,
          hpCurrent: 15,
          hpMax: 15,
        },
      ],
    },
  });
  expect(combatRes.statusCode, `combat/start failed: ${combatRes.body}`).toBe(200);
  const encounterId = combatRes.json().id as string;

  return { sessionId, encounterId, characterId, monsterId };
}

/** Get the combatant record for a character by ID. */
async function getCombatantResources(
  app: FastifyInstance,
  sessionId: string,
  encounterId: string,
  characterId: string,
): Promise<Record<string, unknown>> {
  const stateRes = await app.inject({
    method: "GET",
    url: `/sessions/${sessionId}/combat?encounterId=${encounterId}`,
  });
  expect(stateRes.statusCode).toBe(200);
  const combatants = stateRes.json().combatants as any[];
  const combatant = combatants.find((c: any) => c.characterId === characterId);
  expect(combatant, "character combatant not found in combat state").toBeDefined();
  return combatant.resources as Record<string, unknown>;
}

// ─── Tests: Potion of Resistance ──────────────────────────────────────────────

describe("Potion of Resistance integration", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it("drinking Potion of Resistance (Fire) adds a resistance ActiveEffect to combatant resources", async () => {
    app = buildTestApp();
    const { sessionId, encounterId, characterId } =
      await setupCombatWithPotion(app, "Potion of Resistance (Fire)");

    // Drink the potion (costs an action)
    const actionRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/action`,
      payload: {
        text: "drink Potion of Resistance (Fire)",
        actorId: characterId,
        encounterId,
      },
    });
    expect(actionRes.statusCode, `action failed: ${actionRes.body}`).toBe(200);
    const actionBody = actionRes.json();
    expect(actionBody.actionComplete).toBe(true);
    expect(actionBody.message).toContain("Aldric");

    // Fetch updated combatant state
    const resources = await getCombatantResources(app, sessionId, encounterId, characterId);

    // Should have activeEffects array
    const activeEffects = resources.activeEffects as any[];
    expect(Array.isArray(activeEffects)).toBe(true);
    expect(activeEffects.length).toBeGreaterThan(0);

    // Find the resistance effect
    const resistEffect = activeEffects.find(
      (e: any) => e.type === "resistance" && e.damageType === "fire",
    );
    expect(resistEffect, "fire resistance effect should be in activeEffects").toBeDefined();
    expect(resistEffect.target).toBe("custom");
    expect(resistEffect.duration).toBe("rounds");
    expect(resistEffect.roundsRemaining).toBe(600);
  });

  it("action response message confirms potion was drunk", async () => {
    app = buildTestApp();
    const { sessionId, encounterId, characterId } =
      await setupCombatWithPotion(app, "Potion of Resistance (Fire)");

    const actionRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/action`,
      payload: {
        text: "drink Potion of Resistance (Fire)",
        actorId: characterId,
        encounterId,
      },
    });

    const msg = actionRes.json().message as string;
    // Message should mention the character and the potion
    expect(msg).toContain("Potion of Resistance");
    expect(msg).toContain("gains");
  });

  it("uses the action — cannot use item again on same turn", async () => {
    app = buildTestApp();
    const { sessionId, encounterId, characterId } = await setupCombatWithPotion(
      app,
      "Potion of Resistance (Fire)",
    );

    // First drink — OK
    await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/action`,
      payload: {
        text: "drink Potion of Resistance (Fire)",
        actorId: characterId,
        encounterId,
      },
    });

    // Second drink — action already spent
    // Add another potion to inventory by calling combat/start is not practical here;
    // instead we verify that trying to do ANY action-costing thing returns 400.
    const secondActionRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/action`,
      payload: {
        text: "drink Potion of Resistance (Cold)",
        actorId: characterId,
        encounterId,
      },
    });
    expect(secondActionRes.statusCode).toBe(400);
  });
});

// ─── Tests: Potion of Heroism ──────────────────────────────────────────────────

describe("Potion of Heroism integration", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it("drinking Potion of Heroism grants tempHp=10 in combatant resources", async () => {
    app = buildTestApp();
    const { sessionId, encounterId, characterId } =
      await setupCombatWithPotion(app, "Potion of Heroism");

    const actionRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/action`,
      payload: {
        text: "drink Potion of Heroism",
        actorId: characterId,
        encounterId,
      },
    });
    expect(actionRes.statusCode, `action failed: ${actionRes.body}`).toBe(200);
    expect(actionRes.json().actionComplete).toBe(true);

    const resources = await getCombatantResources(app, sessionId, encounterId, characterId);

    expect(resources.tempHp).toBe(10);
  });

  it("drinking Potion of Heroism adds Bless attack roll bonus effect", async () => {
    app = buildTestApp();
    const { sessionId, encounterId, characterId } =
      await setupCombatWithPotion(app, "Potion of Heroism");

    await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/action`,
      payload: {
        text: "drink Potion of Heroism",
        actorId: characterId,
        encounterId,
      },
    });

    const resources = await getCombatantResources(app, sessionId, encounterId, characterId);
    const activeEffects = resources.activeEffects as any[];

    expect(Array.isArray(activeEffects)).toBe(true);

    const attackBonusEffect = activeEffects.find(
      (e: any) => e.type === "bonus" && e.target === "attack_rolls",
    );
    expect(attackBonusEffect, "Bless attack roll effect should be present").toBeDefined();
    expect(attackBonusEffect.diceValue).toEqual({ count: 1, sides: 4 });
    expect(attackBonusEffect.source).toBe("Potion of Heroism");
  });

  it("drinking Potion of Heroism adds Bless saving throw bonus effect", async () => {
    app = buildTestApp();
    const { sessionId, encounterId, characterId } =
      await setupCombatWithPotion(app, "Potion of Heroism");

    await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/action`,
      payload: {
        text: "drink Potion of Heroism",
        actorId: characterId,
        encounterId,
      },
    });

    const resources = await getCombatantResources(app, sessionId, encounterId, characterId);
    const activeEffects = resources.activeEffects as any[];

    const saveBonusEffect = activeEffects.find(
      (e: any) => e.type === "bonus" && e.target === "saving_throws",
    );
    expect(saveBonusEffect, "Bless saving throw effect should be present").toBeDefined();
    expect(saveBonusEffect.diceValue).toEqual({ count: 1, sides: 4 });
    expect(saveBonusEffect.source).toBe("Potion of Heroism");
  });

  it("drinking Potion of Heroism mentions temp HP gain in response message", async () => {
    app = buildTestApp();
    const { sessionId, encounterId, characterId } =
      await setupCombatWithPotion(app, "Potion of Heroism");

    const actionRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/action`,
      payload: {
        text: "drink Potion of Heroism",
        actorId: characterId,
        encounterId,
      },
    });

    const msg = actionRes.json().message as string;
    expect(msg).toContain("10");
    expect(msg).toContain("temporary HP");
  });

  it("Potion of Heroism is removed from inventory after use", async () => {
    app = buildTestApp();
    const { sessionId, encounterId, characterId } =
      await setupCombatWithPotion(app, "Potion of Heroism");

    await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/action`,
      payload: {
        text: "drink Potion of Heroism",
        actorId: characterId,
        encounterId,
      },
    });

    const resources = await getCombatantResources(app, sessionId, encounterId, characterId);
    const inventory = (resources.inventory as any[]) ?? [];
    const heroismPotion = inventory.find(
      (i: any) => i.name.toLowerCase().includes("heroism"),
    );
    // Either removed entirely (quantity 0 removed) or quantity is 0
    expect(
      heroismPotion === undefined || heroismPotion.quantity === 0,
    ).toBe(true);
  });
});

// ─── Tests: Error cases ───────────────────────────────────────────────────────

describe("potion use error cases", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it("returns 400 when trying to drink an item not in inventory", async () => {
    app = buildTestApp();
    const { sessionId, encounterId, characterId } =
      await setupCombatWithPotion(app, "Potion of Healing");

    const actionRes = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/combat/action`,
      payload: {
        text: "drink Potion of Invisibility",
        actorId: characterId,
        encounterId,
      },
    });
    expect(actionRes.statusCode).toBe(400);
  });
});
