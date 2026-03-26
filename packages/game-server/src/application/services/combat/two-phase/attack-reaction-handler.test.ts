import { beforeEach, describe, expect, it } from "vitest";

import { AttackReactionHandler } from "./attack-reaction-handler.js";
import { CombatantResolver } from "../helpers/combatant-resolver.js";
import {
  InMemoryPendingActionRepository,
  MemoryCharacterRepository,
  MemoryCombatRepository,
  MemoryGameSessionRepository,
  MemoryMonsterRepository,
  MemoryNPCRepository,
} from "../../../../infrastructure/testing/memory-repos.js";
import type { PendingAction } from "../../../../domain/entities/combat/pending-action.js";

const sessionId = "session-uncanny";
const encounterId = "enc-uncanny";
const rogueCharacterId = "char-rogue";
const monsterId = "monster-brute";
const rogueCombatantId = "combatant-rogue";
const monsterCombatantId = "combatant-brute";

function fixedDamageRoller() {
  return {
    rollDie(_sides: number, _count = 1, modifier = 0) {
      return {
        total: Math.max(0, 1 + modifier),
        rolls: [1],
      };
    },
  };
}

describe("AttackReactionHandler - Uncanny Dodge", () => {
  let sessions: MemoryGameSessionRepository;
  let combat: MemoryCombatRepository;
  let characters: MemoryCharacterRepository;
  let monsters: MemoryMonsterRepository;
  let npcs: MemoryNPCRepository;
  let pendingActions: InMemoryPendingActionRepository;
  let handler: AttackReactionHandler;

  beforeEach(async () => {
    sessions = new MemoryGameSessionRepository();
    combat = new MemoryCombatRepository();
    characters = new MemoryCharacterRepository();
    monsters = new MemoryMonsterRepository();
    npcs = new MemoryNPCRepository();
    pendingActions = new InMemoryPendingActionRepository();

    await sessions.create({ id: sessionId, storyFramework: {} });
    await characters.createInSession(sessionId, {
      id: rogueCharacterId,
      name: "Shade",
      level: 7,
      className: "Rogue",
      sheet: {
        className: "Rogue",
        level: 7,
        armorClass: 12,
        maxHp: 40,
        currentHp: 40,
        abilityScores: {
          strength: 10,
          dexterity: 18,
          constitution: 14,
          intelligence: 12,
          wisdom: 12,
          charisma: 10,
        },
      },
    });

    await monsters.createInSession(sessionId, {
      id: monsterId,
      name: "Brute",
      monsterDefinitionId: null,
      statBlock: {
        armorClass: 13,
        hp: 30,
        maxHp: 30,
        abilityScores: {
          strength: 16,
          dexterity: 10,
          constitution: 14,
          intelligence: 8,
          wisdom: 8,
          charisma: 8,
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
        id: rogueCombatantId,
        combatantType: "Character",
        characterId: rogueCharacterId,
        monsterId: null,
        npcId: null,
        initiative: 20,
        hpCurrent: 40,
        hpMax: 40,
        conditions: [],
        resources: {
          reactionUsed: false,
          resourcePools: [],
        },
      },
      {
        id: monsterCombatantId,
        combatantType: "Monster",
        characterId: null,
        monsterId,
        npcId: null,
        initiative: 10,
        hpCurrent: 30,
        hpMax: 30,
        conditions: [],
        resources: {},
      },
    ]);

    const resolver = new CombatantResolver(characters, monsters, npcs);
    handler = new AttackReactionHandler(sessions, combat, resolver, pendingActions);
  });

  it("offers Uncanny Dodge reaction for an eligible rogue", async () => {
    const result = await handler.initiate(sessionId, {
      encounterId,
      actor: { type: "Monster", monsterId },
      target: { type: "Character", characterId: rogueCharacterId },
      attackName: "Greataxe",
      attackRoll: 19,
    });

    expect(result.status).toBe("awaiting_reactions");
    expect(result.pendingActionId).toBeDefined();

    const pending = await pendingActions.getById(result.pendingActionId!);
    expect(pending?.reactionOpportunities).toHaveLength(1);
    expect(pending?.reactionOpportunities[0]?.reactionType).toBe("uncanny_dodge");
  });

  it("halves incoming damage when Uncanny Dodge is used", async () => {
    const initiated = await handler.initiate(sessionId, {
      encounterId,
      actor: { type: "Monster", monsterId },
      target: { type: "Character", characterId: rogueCharacterId },
      attackName: "Greataxe",
      attackRoll: 19,
    });

    const pendingActionId = initiated.pendingActionId!;
    const pending = await pendingActions.getById(pendingActionId);
    const opportunity = pending?.reactionOpportunities[0];

    expect(opportunity?.reactionType).toBe("uncanny_dodge");

    await pendingActions.addReactionResponse(pendingActionId, {
      opportunityId: opportunity!.id,
      combatantId: opportunity!.combatantId,
      choice: "use",
      respondedAt: new Date(),
    });

    const updatedPending = await pendingActions.getById(pendingActionId);
    (updatedPending!.data as PendingAction["data"] & { damageSpec?: unknown }).damageSpec = {
      diceCount: 1,
      diceSides: 1,
      modifier: 9,
      damageType: "slashing",
    };
    await pendingActions.update(updatedPending!);

    const completed = await handler.complete(
      sessionId,
      {
        pendingActionId,
        diceRoller: fixedDamageRoller(),
      },
      {
        async initiateDamageReaction() {
          return { status: "no_reactions" as const };
        },
      },
    );

    expect(completed.hit).toBe(true);
    expect(completed.damageApplied).toBe(5);

    const combatants = await combat.listCombatants(encounterId);
    const rogueState = combatants.find((c) => c.id === rogueCombatantId);
    expect(rogueState?.hpCurrent).toBe(35);
    expect((rogueState?.resources as { reactionUsed?: boolean }).reactionUsed).toBe(true);
  });

  it("cannot trigger Uncanny Dodge a second time in the same round after spending reaction", async () => {
    const initiated = await handler.initiate(sessionId, {
      encounterId,
      actor: { type: "Monster", monsterId },
      target: { type: "Character", characterId: rogueCharacterId },
      attackName: "Greataxe",
      attackRoll: 19,
    });

    const pendingActionId = initiated.pendingActionId!;
    const pending = await pendingActions.getById(pendingActionId);
    const opportunity = pending?.reactionOpportunities[0];

    await pendingActions.addReactionResponse(pendingActionId, {
      opportunityId: opportunity!.id,
      combatantId: opportunity!.combatantId,
      choice: "use",
      respondedAt: new Date(),
    });

    const updatedPending = await pendingActions.getById(pendingActionId);
    (updatedPending!.data as PendingAction["data"] & { damageSpec?: unknown }).damageSpec = {
      diceCount: 1,
      diceSides: 1,
      modifier: 9,
      damageType: "slashing",
    };
    await pendingActions.update(updatedPending!);

    await handler.complete(
      sessionId,
      {
        pendingActionId,
        diceRoller: fixedDamageRoller(),
      },
      {
        async initiateDamageReaction() {
          return { status: "no_reactions" as const };
        },
      },
    );

    const secondAttack = await handler.initiate(sessionId, {
      encounterId,
      actor: { type: "Monster", monsterId },
      target: { type: "Character", characterId: rogueCharacterId },
      attackName: "Greataxe",
      attackRoll: 19,
    });

    expect(secondAttack.status).toBe("hit");
    expect(secondAttack.pendingActionId).toBeUndefined();
    expect(secondAttack.shieldOpportunities).toHaveLength(0);
  });
});
