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

describe("ActionService terrain mechanics", () => {
  let sessions: MemoryGameSessionRepository;
  let combat: MemoryCombatRepository;
  let characters: MemoryCharacterRepository;
  let monsters: MemoryMonsterRepository;
  let npcs: MemoryNPCRepository;
  let service: ActionService;

  const sessionId = "session-terrain-attack";
  const encounterId = "encounter-terrain-attack";
  const characterId = "character-terrain-attack";
  const monsterId = "monster-terrain-attack";
  const characterCombatantId = "combatant-character-terrain-attack";
  const monsterCombatantId = "combatant-monster-terrain-attack";

  beforeEach(async () => {
    sessions = new MemoryGameSessionRepository();
    combat = new MemoryCombatRepository();
    characters = new MemoryCharacterRepository();
    monsters = new MemoryMonsterRepository();
    npcs = new MemoryNPCRepository();

    await sessions.create({ id: sessionId, storyFramework: {} });

    await characters.createInSession(sessionId, {
      id: characterId,
      name: "High Ground Hero",
      level: 1,
      className: "fighter",
      sheet: {
        armorClass: 14,
        abilityScores: {
          strength: 16,
          dexterity: 14,
          constitution: 12,
          intelligence: 10,
          wisdom: 10,
          charisma: 10,
        },
      },
    });

    await monsters.createInSession(sessionId, {
      id: monsterId,
      name: "Low Ground Goblin",
      monsterDefinitionId: null,
      statBlock: {
        armorClass: 15,
        hp: 20,
        abilityScores: {
          strength: 8,
          dexterity: 14,
          constitution: 10,
          intelligence: 8,
          wisdom: 8,
          charisma: 8,
        },
      },
    });

    let map = createCombatMap({
      id: "terrain-map",
      name: "Terrain Map",
      width: 30,
      height: 30,
      gridSize: 5,
    });
    map = setTerrainAt(map, { x: 5, y: 5 }, "elevated", { terrainElevation: 10 });

    await combat.createEncounter(sessionId, {
      id: encounterId,
      status: "Active",
      round: 1,
      turn: 0,
      mapData: map as unknown as Record<string, unknown>,
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
          position: { x: 5, y: 5 },
          speed: 30,
          movementRemaining: 30,
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
          position: { x: 10, y: 5 },
          speed: 30,
        },
      },
    ]);

    const resolver = new CombatantResolver(characters, monsters, npcs);
    service = new ActionService(sessions, combat, resolver);
  });

  it("grants attack advantage from higher elevation", async () => {
    const response = await service.attack(sessionId, {
      encounterId,
      attacker: { type: "Character", characterId },
      target: { type: "Monster", monsterId },
      seed: 9,
      spec: {
        kind: "melee",
        attackBonus: 0,
        damage: { diceCount: 1, diceSides: 6, modifier: 0 },
      },
    });

    const result = response.result as {
      hit: boolean;
      attack: { d20: number; total: number };
    };

    expect(result.hit).toBe(true);
    expect(result.attack.d20).toBe(18);
  });
});
