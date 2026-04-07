import { beforeEach, describe, expect, it } from "vitest";

import { MoveReactionHandler } from "./move-reaction-handler.js";
import { CombatantResolver } from "../helpers/combatant-resolver.js";
import { createCombatMap, setTerrainAt } from "../../../../domain/rules/combat-map.js";
import {
  InMemoryPendingActionRepository,
  MemoryCharacterRepository,
  MemoryCombatRepository,
  MemoryGameSessionRepository,
  MemoryMonsterRepository,
  MemoryNPCRepository,
} from "../../../../infrastructure/testing/memory-repos.js";

describe("MoveReactionHandler", () => {
  let sessions: MemoryGameSessionRepository;
  let combat: MemoryCombatRepository;
  let characters: MemoryCharacterRepository;
  let monsters: MemoryMonsterRepository;
  let npcs: MemoryNPCRepository;
  let pendingActions: InMemoryPendingActionRepository;
  let handler: MoveReactionHandler;

  const sessionId = "session-two-phase-move";
  const encounterId = "enc-two-phase-move";
  const characterId = "char-two-phase-move";
  const monsterId = "monster-two-phase-move";
  const characterCombatantId = "combatant-char-two-phase-move";
  const monsterCombatantId = "combatant-mon-two-phase-move";

  beforeEach(async () => {
    sessions = new MemoryGameSessionRepository();
    combat = new MemoryCombatRepository();
    characters = new MemoryCharacterRepository();
    monsters = new MemoryMonsterRepository();
    npcs = new MemoryNPCRepository();
    pendingActions = new InMemoryPendingActionRepository();

    await sessions.create({ id: sessionId, storyFramework: {} });

    await characters.createInSession(sessionId, {
      id: characterId,
      name: "Mover",
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
      name: "Sentinel",
      monsterDefinitionId: null,
      statBlock: {
        armorClass: 13,
        hp: 18,
        abilityScores: {
          strength: 14,
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
        hpCurrent: 18,
        hpMax: 18,
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
    handler = new MoveReactionHandler(sessions, combat, resolver, pendingActions);
  });

  it("creates a pending move reaction instead of resolving OA immediately", async () => {
    const initiated = await handler.initiate(sessionId, {
      encounterId,
      actor: { type: "Character", characterId },
      destination: { x: 15, y: 0 },
    });

    expect(initiated.status).toBe("awaiting_reactions");
    expect(typeof initiated.pendingActionId).toBe("string");
    expect(initiated.opportunityAttacks).toHaveLength(1);
    expect(initiated.opportunityAttacks[0]?.canAttack).toBe(true);

    const pending = await pendingActions.getById(initiated.pendingActionId!);
    expect(pending?.type).toBe("move");
    expect(pending?.reactionOpportunities).toHaveLength(1);

    const combatants = await combat.listCombatants(encounterId);
    const updatedMonster = combatants.find((combatant) => combatant.id === monsterCombatantId);
    expect((updatedMonster?.resources as { reactionUsed?: boolean }).reactionUsed).toBe(false);
  });

  it("applies pit entry mechanics when completing a pending move", async () => {
    let map = createCombatMap({
      id: "pit-map",
      name: "Pit Map",
      width: 60,
      height: 60,
      gridSize: 5,
    });
    map = setTerrainAt(map, { x: 15, y: 0 }, "pit", { terrainDepth: 20 });
    await combat.updateEncounter(encounterId, { mapData: map as unknown as Record<string, unknown> });

    const initiated = await handler.initiate(sessionId, {
      encounterId,
      actor: { type: "Character", characterId },
      destination: { x: 15, y: 0 },
    });

    expect(initiated.status).toBe("awaiting_reactions");

    const completed = await handler.complete(sessionId, {
      pendingActionId: initiated.pendingActionId!,
    });

    expect(completed.to).toEqual({ x: 15, y: 0 });

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