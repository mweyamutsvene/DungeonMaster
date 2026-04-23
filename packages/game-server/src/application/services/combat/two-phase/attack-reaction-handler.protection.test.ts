import { beforeEach, describe, expect, it } from "vitest";

import { AttackReactionHandler } from "./attack-reaction-handler.js";
import { CombatantResolver } from "../helpers/combatant-resolver.js";
import {
  InMemoryPendingActionRepository,
  MemoryCharacterRepository,
  MemoryCombatRepository,
  MemoryEventRepository,
  MemoryGameSessionRepository,
  MemoryMonsterRepository,
  MemoryNPCRepository,
} from "../../../../infrastructure/testing/memory-repos.js";
import type { PendingAction, PendingAttackData } from "../../../../domain/entities/combat/pending-action.js";

const sessionId = "session-protection";
const encounterId = "enc-protection";
const fighterCharacterId = "char-fighter";
const wizardCharacterId = "char-wizard";
const monsterId = "monster-goblin";
const fighterCombatantId = "combatant-fighter";
const wizardCombatantId = "combatant-wizard";
const monsterCombatantId = "combatant-goblin";

/**
 * Queue-backed dice roller — returns values from a FIFO queue.
 * Each rollDie call consumes `count` values (default 1) and sums them with `modifier`.
 */
function queueRoller(queue: number[]) {
  const values = [...queue];
  return {
    rollDie(_sides: number, count = 1, modifier = 0) {
      let total = modifier;
      const rolls: number[] = [];
      for (let i = 0; i < count; i++) {
        const v = values.shift() ?? 1;
        total += v;
        rolls.push(v);
      }
      return { total, rolls };
    },
  };
}

async function setupEncounter(args: {
  sessions: MemoryGameSessionRepository;
  combat: MemoryCombatRepository;
  characters: MemoryCharacterRepository;
  monsters: MemoryMonsterRepository;
}) {
  const { sessions, combat, characters, monsters } = args;
  await sessions.create({ id: sessionId, storyFramework: {} });

  // Fighter protector — Protection style + shield, level 5, adjacent to target.
  await characters.createInSession(sessionId, {
    id: fighterCharacterId,
    name: "Thane",
    level: 5,
    className: "Fighter",
    sheet: {
      className: "Fighter",
      level: 5,
      armorClass: 18,
      maxHp: 44,
      currentHp: 44,
      abilityScores: {
        strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 10,
      },
    },
  });

  // Wizard target — squishy PC.
  await characters.createInSession(sessionId, {
    id: wizardCharacterId,
    name: "Vex",
    level: 5,
    className: "Wizard",
    sheet: {
      className: "Wizard",
      level: 5,
      armorClass: 12,
      maxHp: 27,
      currentHp: 27,
      abilityScores: {
        strength: 8, dexterity: 14, constitution: 12, intelligence: 18, wisdom: 12, charisma: 10,
      },
    },
  });

  await monsters.createInSession(sessionId, {
    id: monsterId,
    name: "Goblin",
    monsterDefinitionId: null,
    statBlock: {
      armorClass: 15,
      hp: 12,
      maxHp: 12,
      abilityScores: {
        strength: 10, dexterity: 14, constitution: 10, intelligence: 8, wisdom: 8, charisma: 8,
      },
    },
  });

  await combat.createEncounter(sessionId, {
    id: encounterId,
    status: "Active",
    round: 1,
    turn: 0,
  });

  await combat.createCombatants(encounterId, [
    {
      id: fighterCombatantId,
      combatantType: "Character",
      characterId: fighterCharacterId,
      monsterId: null,
      npcId: null,
      initiative: 15,
      hpCurrent: 44,
      hpMax: 44,
      conditions: [],
      resources: {
        position: { x: 5, y: 0 },
        speed: 30,
        reactionUsed: false,
        hasProtectionStyle: true,
        hasInterceptionStyle: false,
        hasShieldEquipped: true,
        hasWeaponEquipped: true,
      },
    },
    {
      id: wizardCombatantId,
      combatantType: "Character",
      characterId: wizardCharacterId,
      monsterId: null,
      npcId: null,
      initiative: 12,
      hpCurrent: 27,
      hpMax: 27,
      conditions: [],
      resources: {
        position: { x: 0, y: 0 },
        speed: 30,
        reactionUsed: false,
      },
    },
    {
      id: monsterCombatantId,
      combatantType: "Monster",
      characterId: null,
      monsterId,
      npcId: null,
      initiative: 10,
      hpCurrent: 12,
      hpMax: 12,
      conditions: [],
      resources: {
        position: { x: 5, y: 5 },
        speed: 30,
        reach: 5,
      },
    },
  ]);
}

/**
 * After initiate(), mutate the pending action's attackData to inject the
 * d20 roll / bonus / rollMode fields that production code populates post-initiate.
 */
async function primeAttackData(
  pendingActions: InMemoryPendingActionRepository,
  pendingActionId: string,
  overrides: Partial<PendingAttackData>,
) {
  const pending = await pendingActions.getById(pendingActionId);
  if (!pending) throw new Error("pending action missing");
  Object.assign(pending.data as PendingAttackData, overrides);
  await pendingActions.update(pending);
}

describe("AttackReactionHandler — Protection fighting style", () => {
  let sessions: MemoryGameSessionRepository;
  let combat: MemoryCombatRepository;
  let characters: MemoryCharacterRepository;
  let monsters: MemoryMonsterRepository;
  let npcs: MemoryNPCRepository;
  let pendingActions: InMemoryPendingActionRepository;
  let events: MemoryEventRepository;
  let handler: AttackReactionHandler;

  beforeEach(async () => {
    sessions = new MemoryGameSessionRepository();
    combat = new MemoryCombatRepository();
    characters = new MemoryCharacterRepository();
    monsters = new MemoryMonsterRepository();
    npcs = new MemoryNPCRepository();
    pendingActions = new InMemoryPendingActionRepository();
    events = new MemoryEventRepository();
    await setupEncounter({ sessions, combat, characters, monsters });

    const resolver = new CombatantResolver(characters, monsters, npcs);
    handler = new AttackReactionHandler(sessions, combat, resolver, pendingActions, events);
  });

  async function initiateAgainstWizard(attackRoll: number) {
    return handler.initiate(sessionId, {
      encounterId,
      actor: { type: "Monster", monsterId },
      target: { type: "Character", characterId: wizardCharacterId },
      attackName: "Scimitar",
      attackRoll,
    });
  }

  async function acceptProtection(pendingActionId: string) {
    const pending = await pendingActions.getById(pendingActionId);
    const opp = pending?.reactionOpportunities.find((o) => o.reactionType === "protection");
    expect(opp, "Protection reaction opportunity should be offered").toBeDefined();
    await pendingActions.addReactionResponse(pendingActionId, {
      opportunityId: opp!.id,
      combatantId: opp!.combatantId,
      choice: "use",
      respondedAt: new Date(),
    });
    return opp!;
  }

  it("normal rollMode: takes min(original d20, new d20); hit-18 becomes miss-5", async () => {
    const initiated = await initiateAgainstWizard(18);
    expect(initiated.status).toBe("awaiting_reactions");

    const pendingActionId = initiated.pendingActionId!;
    await primeAttackData(pendingActions, pendingActionId, {
      d20Roll: 18,
      attackBonus: 0,
      attackTotal: 18,
      attackRoll: 18,
      rollMode: "normal",
      originalRollMode: "normal",
      targetAC: 12,
      damageSpec: { diceCount: 1, diceSides: 1, modifier: 5, damageType: "slashing" },
    });

    await acceptProtection(pendingActionId);

    const completed = await handler.complete(
      sessionId,
      {
        pendingActionId,
        // Protection re-rolls a single d20 → 5. min(18, 5) = 5 → total 5 vs AC 12 → miss.
        diceRoller: queueRoller([5]),
      },
      {
        async initiateDamageReaction() {
          return { status: "no_reactions" as const };
        },
      },
    );

    expect(completed.hit).toBe(false);
    expect(completed.damageApplied).toBe(0);

    const combatants = await combat.listCombatants(encounterId);
    const wizardState = combatants.find((c) => c.id === wizardCombatantId);
    const fighterState = combatants.find((c) => c.id === fighterCombatantId);
    // Wizard HP unchanged.
    expect(wizardState?.hpCurrent).toBe(27);
    // Protector's reaction was consumed.
    expect((fighterState?.resources as { reactionUsed?: boolean }).reactionUsed).toBe(true);
    // Target's reaction was NOT consumed by Protection.
    expect((wizardState?.resources as { reactionUsed?: boolean }).reactionUsed).toBe(false);

    // ProtectionApplied event emitted with the new post-reroll d20.
    const applied = (await events.listBySession(sessionId)).find((e) => e.type === "ProtectionApplied");
    expect(applied, "expected ProtectionApplied event").toBeDefined();
    expect(applied?.payload).toMatchObject({
      protectorId: fighterCombatantId,
      originalRoll: 18,
      newRoll: 5,
      hitBecameMiss: true,
    });
  });

  it("advantage rollMode: Protection = adv+disadv = straight; rolls ONE fresh d20 (not min-of-3)", async () => {
    const initiated = await initiateAgainstWizard(18);
    const pendingActionId = initiated.pendingActionId!;
    await primeAttackData(pendingActions, pendingActionId, {
      d20Roll: 18,
      attackBonus: 0,
      attackTotal: 18,
      attackRoll: 18,
      rollMode: "advantage",
      originalRollMode: "advantage",
      targetAC: 12,
      damageSpec: { diceCount: 1, diceSides: 1, modifier: 5, damageType: "slashing" },
    });

    await acceptProtection(pendingActionId);

    // Queue exactly ONE d20 value for Protection's reroll. If handler tried to take
    // min-of-3 it would consume more values and the test would drift — this asserts
    // "one fresh d20" semantics.
    const queued = [5];
    const roller = queueRoller(queued);

    const completed = await handler.complete(
      sessionId,
      { pendingActionId, diceRoller: roller },
      { async initiateDamageReaction() { return { status: "no_reactions" as const }; } },
    );

    // Only one d20 value was consumed by Protection (damageSpec rolls d1 after).
    expect(completed.hit).toBe(false);
    expect(completed.damageApplied).toBe(0);

    const fighterState = (await combat.listCombatants(encounterId)).find((c) => c.id === fighterCombatantId);
    expect((fighterState?.resources as { reactionUsed?: boolean }).reactionUsed).toBe(true);
  });

  it("disadvantage rollMode: Protection is redundant — reaction NOT consumed, ProtectionRedundant emitted", async () => {
    const initiated = await initiateAgainstWizard(18);
    const pendingActionId = initiated.pendingActionId!;
    await primeAttackData(pendingActions, pendingActionId, {
      d20Roll: 18,
      attackBonus: 0,
      attackTotal: 18,
      attackRoll: 18,
      rollMode: "disadvantage",
      originalRollMode: "disadvantage",
      targetAC: 12,
      damageSpec: { diceCount: 1, diceSides: 1, modifier: 5, damageType: "slashing" },
    });

    await acceptProtection(pendingActionId);

    const completed = await handler.complete(
      sessionId,
      {
        pendingActionId,
        // No Protection d20 should be rolled. The only roll the handler will make
        // here is the damage roll (1d1+5). Provide it explicitly.
        diceRoller: queueRoller([1]),
      },
      { async initiateDamageReaction() { return { status: "no_reactions" as const }; } },
    );

    // Attack still hits (Protection did not alter the roll).
    expect(completed.hit).toBe(true);
    expect(completed.damageApplied).toBeGreaterThan(0);

    // Protector's reaction is NOT consumed in the redundant case.
    const fighterState = (await combat.listCombatants(encounterId)).find((c) => c.id === fighterCombatantId);
    expect((fighterState?.resources as { reactionUsed?: boolean }).reactionUsed).toBeFalsy();

    // ProtectionRedundant event emitted.
    const recorded = await events.listBySession(sessionId);
    const redundant = recorded.find((e) => e.type === "ProtectionRedundant");
    expect(redundant, "expected ProtectionRedundant event").toBeDefined();
    expect(redundant?.payload).toMatchObject({ protectorId: fighterCombatantId, reason: "attack-already-at-disadvantage" });

    // ProtectionApplied should NOT have been emitted.
    expect(recorded.find((e) => e.type === "ProtectionApplied")).toBeUndefined();
  });
});
