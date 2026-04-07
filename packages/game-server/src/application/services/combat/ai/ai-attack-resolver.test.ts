import { describe, it, expect, vi } from "vitest";
import { AiAttackResolver } from "./ai-attack-resolver.js";
import type { CombatEncounterRecord, CombatantStateRecord } from "../../../types.js";

function makeCombatant(overrides: Partial<CombatantStateRecord> & { id: string }): CombatantStateRecord {
  return {
    id: overrides.id,
    encounterId: "enc-1",
    combatantType: "Monster",
    characterId: null,
    monsterId: "monster-1",
    npcId: null,
    initiative: 10,
    hpCurrent: 20,
    hpMax: 20,
    conditions: [],
    resources: { position: { x: 0, y: 0 } },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeEncounter(): CombatEncounterRecord {
  return {
    id: "enc-1",
    sessionId: "session-1",
    status: "Active",
    round: 1,
    turn: 0,
    mapData: { flankingEnabled: true } as any,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe("AiAttackResolver flanking data preloading (AI-L2)", () => {
  it("uses preloaded encounter and combatants without extra combat repo reads", async () => {
    const aiCombatant = makeCombatant({
      id: "ai-1",
      resources: { position: { x: 0, y: 0 } },
    });
    const targetCombatant = makeCombatant({
      id: "target-1",
      combatantType: "Character",
      characterId: "char-1",
      monsterId: null,
      resources: { position: { x: 5, y: 0 } },
    });
    const allyCombatant = makeCombatant({
      id: "ally-1",
      resources: { position: { x: 10, y: 0 } },
    });

    const combat = {
      getEncounterById: vi.fn().mockResolvedValue(makeEncounter()),
      listCombatants: vi.fn().mockResolvedValue([aiCombatant, targetCombatant, allyCombatant]),
      updateCombatantState: vi.fn().mockResolvedValue(undefined),
      setPendingAction: vi.fn().mockResolvedValue(undefined),
    } as any;

    const resolver = new AiAttackResolver({
      combat,
      twoPhaseActions: {
        initiateAttack: vi.fn().mockResolvedValue({ status: "miss" }),
      } as any,
      pendingActions: {} as any,
      combatantResolver: {
        getCombatStats: vi.fn().mockResolvedValue({ armorClass: 12 }),
      } as any,
      diceRoller: {
        d20: vi.fn().mockReturnValue({ total: 10 }),
        rollDie: vi.fn().mockReturnValue({ total: 1 }),
      } as any,
      aiLog: vi.fn(),
      events: undefined,
    });

    const result = await resolver.resolve({
      sessionId: "session-1",
      encounterId: "enc-1",
      encounter: makeEncounter(),
      allCombatants: [aiCombatant, targetCombatant, allyCombatant],
      aiCombatant,
      targetCombatant,
      actorRef: { type: "Monster", monsterId: "monster-1" },
      targetRef: { type: "Character", characterId: "char-1" },
      attackName: "Bite",
      monsterAttacks: [
        {
          name: "Bite",
          kind: "melee",
          attackBonus: 5,
          damage: { diceCount: 1, diceSides: 6, modifier: 2 },
        },
      ],
    });

    expect(result.status).toBe("miss");
    expect(combat.getEncounterById).not.toHaveBeenCalled();
    expect(combat.listCombatants).not.toHaveBeenCalled();
  });

  it("falls back to combat repo reads when preloaded values are not provided", async () => {
    const encounter = makeEncounter();
    const aiCombatant = makeCombatant({
      id: "ai-1",
      resources: { position: { x: 0, y: 0 } },
    });
    const targetCombatant = makeCombatant({
      id: "target-1",
      combatantType: "Character",
      characterId: "char-1",
      monsterId: null,
      resources: { position: { x: 5, y: 0 } },
    });
    const allyCombatant = makeCombatant({
      id: "ally-1",
      resources: { position: { x: 10, y: 0 } },
    });

    const combat = {
      getEncounterById: vi.fn().mockResolvedValue(encounter),
      listCombatants: vi.fn().mockResolvedValue([aiCombatant, targetCombatant, allyCombatant]),
      updateCombatantState: vi.fn().mockResolvedValue(undefined),
      setPendingAction: vi.fn().mockResolvedValue(undefined),
    } as any;

    const resolver = new AiAttackResolver({
      combat,
      twoPhaseActions: {
        initiateAttack: vi.fn().mockResolvedValue({ status: "miss" }),
      } as any,
      pendingActions: {} as any,
      combatantResolver: {
        getCombatStats: vi.fn().mockResolvedValue({ armorClass: 12 }),
      } as any,
      diceRoller: {
        d20: vi.fn().mockReturnValue({ total: 10 }),
        rollDie: vi.fn().mockReturnValue({ total: 1 }),
      } as any,
      aiLog: vi.fn(),
      events: undefined,
    });

    const result = await resolver.resolve({
      sessionId: "session-1",
      encounterId: "enc-1",
      aiCombatant,
      targetCombatant,
      actorRef: { type: "Monster", monsterId: "monster-1" },
      targetRef: { type: "Character", characterId: "char-1" },
      attackName: "Bite",
      monsterAttacks: [
        {
          name: "Bite",
          kind: "melee",
          attackBonus: 5,
          damage: { diceCount: 1, diceSides: 6, modifier: 2 },
        },
      ],
    });

    expect(result.status).toBe("miss");
    expect(combat.getEncounterById).toHaveBeenCalledWith("enc-1");
    expect(combat.listCombatants).toHaveBeenCalledWith("enc-1");
  });
});
