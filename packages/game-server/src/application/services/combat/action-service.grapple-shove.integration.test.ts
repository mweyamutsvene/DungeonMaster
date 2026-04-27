import { beforeEach, describe, expect, it } from "vitest";

import { ActionService } from "./action-service.js";
import { CombatantResolver } from "./helpers/combatant-resolver.js";
import { getAttacksUsedThisTurn, hasSpentAction } from "./helpers/resource-utils.js";
import {
  MemoryCharacterRepository,
  MemoryCombatRepository,
  MemoryGameSessionRepository,
  MemoryMonsterRepository,
  MemoryNPCRepository,
} from "../../../infrastructure/testing/memory-repos.js";

describe("ActionService.grapple - save proficiency parity", () => {
  let sessions: MemoryGameSessionRepository;
  let combat: MemoryCombatRepository;
  let characters: MemoryCharacterRepository;
  let monsters: MemoryMonsterRepository;
  let npcs: MemoryNPCRepository;
  let service: ActionService;

  const sessionId = "session-grapple-prof";
  const encounterId = "encounter-grapple-prof";
  const grapplerId = "character-grappler";
  const nonProfTargetId = "monster-no-save-prof";
  const profTargetId = "monster-with-save-prof";

  const grapplerCombatantId = "combatant-grappler";
  const nonProfCombatantId = "combatant-target-no-prof";
  const profCombatantId = "combatant-target-prof";

  beforeEach(async () => {
    sessions = new MemoryGameSessionRepository();
    combat = new MemoryCombatRepository();
    characters = new MemoryCharacterRepository();
    monsters = new MemoryMonsterRepository();
    npcs = new MemoryNPCRepository();

    await sessions.create({ id: sessionId, storyFramework: {} });

    await characters.createInSession(sessionId, {
      id: grapplerId,
      name: "Arena Grappler",
      level: 5,
      className: "fighter",
      sheet: {
        armorClass: 16,
        speed: 30,
        level: 5,
        abilityScores: {
          strength: 16,
          dexterity: 10,
          constitution: 14,
          intelligence: 8,
          wisdom: 10,
          charisma: 10,
        },
      },
    });

    await monsters.createInSession(sessionId, {
      id: nonProfTargetId,
      name: "No Prof Defender",
      monsterDefinitionId: null,
      statBlock: {
        armorClass: 10,
        hp: 25,
        maxHp: 25,
        speed: 30,
        size: "Medium",
        challengeRating: 1,
        abilityScores: {
          strength: 12,
          dexterity: 12,
          constitution: 12,
          intelligence: 8,
          wisdom: 10,
          charisma: 8,
        },
      },
    });

    await monsters.createInSession(sessionId, {
      id: profTargetId,
      name: "Save Pro Defender",
      monsterDefinitionId: null,
      statBlock: {
        armorClass: 10,
        hp: 25,
        maxHp: 25,
        speed: 30,
        size: "Medium",
        challengeRating: 1,
        saveProficiencies: ["strength"],
        abilityScores: {
          strength: 12,
          dexterity: 12,
          constitution: 12,
          intelligence: 8,
          wisdom: 10,
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
        id: grapplerCombatantId,
        combatantType: "Character",
        characterId: grapplerId,
        monsterId: null,
        npcId: null,
        initiative: 20,
        hpCurrent: 45,
        hpMax: 45,
        conditions: [],
        resources: {
          position: { x: 10, y: 10 },
          speed: 30,
          movementRemaining: 30,
          reactionUsed: false,
          attacksAllowedThisTurn: 2,
          attacksUsedThisTurn: 0,
        },
      },
      {
        id: nonProfCombatantId,
        combatantType: "Monster",
        characterId: null,
        monsterId: nonProfTargetId,
        npcId: null,
        initiative: 10,
        hpCurrent: 25,
        hpMax: 25,
        conditions: [],
        resources: {
          position: { x: 15, y: 10 },
          speed: 30,
          reactionUsed: false,
        },
      },
      {
        id: profCombatantId,
        combatantType: "Monster",
        characterId: null,
        monsterId: profTargetId,
        npcId: null,
        initiative: 8,
        hpCurrent: 25,
        hpMax: 25,
        conditions: [],
        resources: {
          position: { x: 10, y: 15 },
          speed: 30,
          reactionUsed: false,
        },
      },
    ]);

    const resolver = new CombatantResolver(characters, monsters, npcs);
    service = new ActionService(sessions, combat, resolver);
  });

  it("save-proficient target can resist grapple under the same seed while non-proficient target fails", async () => {
    const sharedSeed = 11;

    const nonProf = await service.grapple(sessionId, {
      encounterId,
      actor: { type: "Character", characterId: grapplerId },
      target: { type: "Monster", monsterId: nonProfTargetId },
      seed: sharedSeed,
    });

    const withProf = await service.grapple(sessionId, {
      encounterId,
      actor: { type: "Character", characterId: grapplerId },
      target: { type: "Monster", monsterId: profTargetId },
      seed: sharedSeed,
    });

    expect(nonProf.result.hit).toBe(true);
    expect(withProf.result.hit).toBe(true);

    expect(nonProf.result.success).toBe(true);
    expect(withProf.result.success).toBe(false);

    const combatants = await combat.listCombatants(encounterId);
    const grappler = combatants.find((c) => c.id === grapplerCombatantId);

    expect(grappler).toBeDefined();
    expect(getAttacksUsedThisTurn(grappler!.resources)).toBe(2);
    expect(hasSpentAction(grappler!.resources)).toBe(true);
  });

  it("grapple miss consumes only one attack when Extra Attack has remaining slots", async () => {
    const missSeed = 7;

    const missAttempt = await service.grapple(sessionId, {
      encounterId,
      actor: { type: "Character", characterId: grapplerId },
      target: { type: "Monster", monsterId: nonProfTargetId },
      seed: missSeed,
    });

    expect(missAttempt.result.hit).toBe(false);
    expect(missAttempt.result.success).toBe(false);

    const combatants = await combat.listCombatants(encounterId);
    const grappler = combatants.find((c) => c.id === grapplerCombatantId);

    expect(grappler).toBeDefined();
    expect(getAttacksUsedThisTurn(grappler!.resources)).toBe(1);
    expect(hasSpentAction(grappler!.resources)).toBe(false);
  });
});
