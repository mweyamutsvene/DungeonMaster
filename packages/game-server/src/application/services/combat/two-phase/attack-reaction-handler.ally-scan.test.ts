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

const sessionId = "session-ally-scan";
const encounterId = "enc-ally-scan";
const fighterCharacterId = "char-fighter-ally";
const allyCharacterId = "char-ally-target";
const monsterId = "monster-attacker";
const fighterCombatantId = "combatant-fighter-ally";
const allyCombatantId = "combatant-ally-target";
const monsterCombatantId = "combatant-attacker";

interface Overrides {
  fighterPosition?: { x: number; y: number };
  fighterConditions?: Array<{ condition: string; duration: string; source?: string; roundsRemaining?: number }>;
  fighterReactionUsed?: boolean;
  targetRef?: "fighter" | "ally" | "attacker";
}

async function setup(overrides: Overrides = {}) {
  const sessions = new MemoryGameSessionRepository();
  const combat = new MemoryCombatRepository();
  const characters = new MemoryCharacterRepository();
  const monsters = new MemoryMonsterRepository();
  const npcs = new MemoryNPCRepository();
  const pendingActions = new InMemoryPendingActionRepository();

  await sessions.create({ id: sessionId, storyFramework: {} });

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
      abilityScores: { strength: 16, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 10 },
    },
  });

  await characters.createInSession(sessionId, {
    id: allyCharacterId,
    name: "Vex",
    level: 5,
    className: "Wizard",
    sheet: {
      className: "Wizard",
      level: 5,
      armorClass: 12,
      maxHp: 27,
      currentHp: 27,
      abilityScores: { strength: 8, dexterity: 14, constitution: 12, intelligence: 18, wisdom: 12, charisma: 10 },
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
      abilityScores: { strength: 10, dexterity: 14, constitution: 10, intelligence: 8, wisdom: 8, charisma: 8 },
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
      conditions: overrides.fighterConditions ?? [],
      resources: {
        position: overrides.fighterPosition ?? { x: 5, y: 0 },
        speed: 30,
        reactionUsed: overrides.fighterReactionUsed ?? false,
        hasProtectionStyle: true,
        hasInterceptionStyle: false,
        hasShieldEquipped: true,
        hasWeaponEquipped: true,
      },
    },
    {
      id: allyCombatantId,
      combatantType: "Character",
      characterId: allyCharacterId,
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

  const resolver = new CombatantResolver(characters, monsters, npcs);
  const handler = new AttackReactionHandler(sessions, combat, resolver, pendingActions);
  return { handler, pendingActions };
}

function countProtectionOpps(opps: Array<{ reactionType: string; combatantId: string }>) {
  return opps.filter((o) => o.reactionType === "protection").length;
}

describe("AttackReactionHandler — ally-scan rejection cases", () => {
  let handler: AttackReactionHandler;
  let pendingActions: InMemoryPendingActionRepository;

  beforeEach(async () => {
    ({ handler, pendingActions } = await setup());
  });

  it("does NOT offer Protection when the protector is the attacker (skipped by scan loop)", async () => {
    // Use the Fighter character as the attacker. The scan loop skips `other.id === actor.id`,
    // which prevents the Fighter from protecting against its own attack.
    const result = await handler.initiate(sessionId, {
      encounterId,
      actor: { type: "Character", characterId: fighterCharacterId },
      target: { type: "Character", characterId: allyCharacterId },
      attackRoll: 18,
    });

    if (result.pendingActionId) {
      const pending = await pendingActions.getById(result.pendingActionId);
      expect(countProtectionOpps(pending?.reactionOpportunities ?? [])).toBe(0);
    } else {
      // No pending action = no reactions at all.
      expect(result.status === "hit" || result.status === "miss").toBe(true);
    }
  });

  it("does NOT offer Protection when the protector is the target (skipped by scan loop)", async () => {
    // Attack targets the Fighter directly. The scan loop skips `other.id === target.id`,
    // so the Fighter cannot protect themselves via the ally-scan path.
    const result = await handler.initiate(sessionId, {
      encounterId,
      actor: { type: "Monster", monsterId },
      target: { type: "Character", characterId: fighterCharacterId },
      attackRoll: 22, // hit
    });

    if (result.pendingActionId) {
      const pending = await pendingActions.getById(result.pendingActionId);
      expect(countProtectionOpps(pending?.reactionOpportunities ?? [])).toBe(0);
    } else {
      expect(result.status === "hit" || result.status === "miss").toBe(true);
    }
  });

  it("does NOT offer Protection when the protector is Incapacitated", async () => {
    ({ handler, pendingActions } = await setup({
      fighterConditions: [{ condition: "Incapacitated", duration: "until_removed", source: "psychic-blast" }],
    }));

    const result = await handler.initiate(sessionId, {
      encounterId,
      actor: { type: "Monster", monsterId },
      target: { type: "Character", characterId: allyCharacterId },
      attackRoll: 18,
    });

    if (result.pendingActionId) {
      const pending = await pendingActions.getById(result.pendingActionId);
      expect(countProtectionOpps(pending?.reactionOpportunities ?? [])).toBe(0);
    } else {
      expect(result.status === "hit").toBe(true);
    }
  });

  it("does NOT offer Protection when the protector's reaction has already been used", async () => {
    ({ handler, pendingActions } = await setup({ fighterReactionUsed: true }));

    const result = await handler.initiate(sessionId, {
      encounterId,
      actor: { type: "Monster", monsterId },
      target: { type: "Character", characterId: allyCharacterId },
      attackRoll: 18,
    });

    if (result.pendingActionId) {
      const pending = await pendingActions.getById(result.pendingActionId);
      expect(countProtectionOpps(pending?.reactionOpportunities ?? [])).toBe(0);
    } else {
      expect(result.status === "hit").toBe(true);
    }
  });

  it("does NOT offer Protection when the protector is more than 5 ft from the target", async () => {
    // Fighter placed 10 feet away (chebyshev distance 10).
    ({ handler, pendingActions } = await setup({ fighterPosition: { x: 10, y: 0 } }));

    const result = await handler.initiate(sessionId, {
      encounterId,
      actor: { type: "Monster", monsterId },
      target: { type: "Character", characterId: allyCharacterId },
      attackRoll: 18,
    });

    if (result.pendingActionId) {
      const pending = await pendingActions.getById(result.pendingActionId);
      expect(countProtectionOpps(pending?.reactionOpportunities ?? [])).toBe(0);
    } else {
      expect(result.status === "hit").toBe(true);
    }
  });

  it("baseline: DOES offer Protection when protector is adjacent, eligible, and un-used", async () => {
    // Sanity check that the setup correctly offers Protection when nothing disqualifies it.
    const result = await handler.initiate(sessionId, {
      encounterId,
      actor: { type: "Monster", monsterId },
      target: { type: "Character", characterId: allyCharacterId },
      attackRoll: 18,
    });

    expect(result.status).toBe("awaiting_reactions");
    const pending = await pendingActions.getById(result.pendingActionId!);
    expect(countProtectionOpps(pending?.reactionOpportunities ?? [])).toBe(1);
  });
});
