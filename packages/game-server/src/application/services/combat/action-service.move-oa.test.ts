import { beforeEach, describe, expect, it } from "vitest";

import { ActionService } from "./action-service.js";
import { CombatantResolver } from "./helpers/combatant-resolver.js";
import { createCombatMap, setTerrainAt } from "../../../domain/rules/combat-map.js";
import {
  MemoryCharacterRepository,
  MemoryCombatRepository,
  MemoryGameSessionRepository,
  MemoryMonsterRepository,
  MemoryNPCRepository,
} from "../../../infrastructure/testing/memory-repos.js";

describe("ActionService.move - opportunity attacks", () => {
  let sessions: MemoryGameSessionRepository;
  let combat: MemoryCombatRepository;
  let characters: MemoryCharacterRepository;
  let monsters: MemoryMonsterRepository;
  let npcs: MemoryNPCRepository;
  let service: ActionService;

  const sessionId = "session-move-oa";
  const encounterId = "encounter-move-oa";
  const characterId = "character-move-oa";
  const monsterId = "monster-move-oa";
  const characterCombatantId = "combatant-character-move-oa";
  const monsterCombatantId = "combatant-monster-move-oa";

  beforeEach(async () => {
    sessions = new MemoryGameSessionRepository();
    combat = new MemoryCombatRepository();
    characters = new MemoryCharacterRepository();
    monsters = new MemoryMonsterRepository();
    npcs = new MemoryNPCRepository();

    await sessions.create({ id: sessionId, storyFramework: {} });

    await characters.createInSession(sessionId, {
      id: characterId,
      name: "Runner",
      level: 1,
      className: "fighter",
      sheet: {
        armorClass: 14,
        abilityScores: {
          strength: 14,
          dexterity: 12,
          constitution: 12,
          intelligence: 10,
          wisdom: 10,
          charisma: 10,
        },
      },
    });

    await monsters.createInSession(sessionId, {
      id: monsterId,
      name: "Guard",
      monsterDefinitionId: null,
      statBlock: {
        armorClass: 13,
        hp: 20,
        abilityScores: {
          strength: 14,
          dexterity: 10,
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
        id: characterCombatantId,
        combatantType: "Character",
        characterId,
        monsterId: null,
        npcId: null,
        initiative: 20,
        hpCurrent: 18,
        hpMax: 18,
        conditions: [],
        resources: {
          position: { x: 0, y: 0 },
          speed: 30,
          movementRemaining: 30,
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
        hpCurrent: 20,
        hpMax: 20,
        conditions: [],
        resources: {
          position: { x: 5, y: 0 },
          speed: 30,
          reach: 5,
          reactionUsed: false,
        },
      },
    ]);

    const resolver = new CombatantResolver(characters, monsters, npcs);
    service = new ActionService(sessions, combat, resolver);
  });

  it("resolves OA immediately during move without creating pending reactions", async () => {
    const moved = await service.move(sessionId, {
      encounterId,
      actor: { type: "Character", characterId },
      destination: { x: 15, y: 0 },
    });

    expect(moved.result.from).toEqual({ x: 0, y: 0 });
    expect(moved.result.to).toEqual({ x: 15, y: 0 });
    expect(moved.result.opportunityAttacks).toHaveLength(1);
    expect(moved.opportunityAttacks).toEqual([
      {
        attackerId: monsterCombatantId,
        targetId: characterCombatantId,
        canAttack: true,
        hasReaction: false,
      },
    ]);

    const combatants = await combat.listCombatants(encounterId);
    const updatedMonster = combatants.find((combatant) => combatant.id === monsterCombatantId);
    const updatedCharacter = combatants.find((combatant) => combatant.id === characterCombatantId);

    expect((updatedMonster?.resources as { reactionUsed?: boolean }).reactionUsed).toBe(true);
    expect((updatedCharacter?.resources as { position?: { x: number; y: number } }).position).toEqual({
      x: 15,
      y: 0,
    });
  });

  it("applies pit entry effects on move into pit terrain", async () => {
    let map = createCombatMap({
      id: "pit-map",
      name: "Pit Map",
      width: 60,
      height: 60,
      gridSize: 5,
    });
    map = setTerrainAt(map, { x: 15, y: 0 }, "pit", { terrainDepth: 20 });

    await combat.updateEncounter(encounterId, { mapData: map as unknown as Record<string, unknown> });

    // Move the monster away so OA does not interfere with pit assertions.
    await combat.updateCombatantState(monsterCombatantId, {
      resources: {
        position: { x: 50, y: 50 },
        speed: 30,
        reach: 5,
        reactionUsed: false,
      },
    });

    await service.move(sessionId, {
      encounterId,
      actor: { type: "Character", characterId },
      destination: { x: 15, y: 0 },
      seed: 9,
    });

    const combatants = await combat.listCombatants(encounterId);
    const movedCharacter = combatants.find((combatant) => combatant.id === characterCombatantId);
    const movedResources = movedCharacter?.resources as {
      movementRemaining?: number;
      movementSpent?: boolean;
      position?: { x: number; y: number };
    };

    expect(movedResources.position).toEqual({ x: 15, y: 0 });
    expect(movedResources.movementRemaining).toBe(0);
    expect(movedResources.movementSpent).toBe(true);
    expect((movedCharacter?.hpCurrent ?? 18) < 18 || (movedCharacter?.conditions as Array<{ condition: string }> | undefined)?.some(c => c.condition === "Prone")).toBe(true);
  });
});