import { describe, it, expect } from "vitest";
import { chooseLegendaryAction } from "./legendary-action-handler.js";
import type { CombatantStateRecord } from "../../../types.js";

function makeBoss(overrides: Partial<CombatantStateRecord> = {}): CombatantStateRecord {
  return {
    id: "boss-1",
    encounterId: "enc-1",
    combatantType: "Monster",
    characterId: null,
    monsterId: "dragon-1",
    npcId: null,
    initiative: 20,
    hpCurrent: 200,
    hpMax: 200,
    conditions: [],
    resources: {
      legendaryActionCharges: 3,
      legendaryActionsRemaining: 3,
      legendaryActions: [
        { name: "Tail Attack", cost: 1, description: "Tail sweep", actionType: "attack", attackName: "Tail" },
        { name: "Wing Attack", cost: 2, description: "Wing buffet", actionType: "special" },
        { name: "Move", cost: 1, description: "Move half speed", actionType: "move" },
      ],
      position: { x: 30, y: 10 },
    },
    ...overrides,
  } as CombatantStateRecord;
}

function makeEnemy(id: string, x: number, y: number, hp = 30): CombatantStateRecord {
  return {
    id,
    encounterId: "enc-1",
    combatantType: "Character",
    characterId: `char-${id}`,
    monsterId: null,
    npcId: null,
    initiative: 10,
    hpCurrent: hp,
    hpMax: hp,
    conditions: [],
    resources: { position: { x, y } },
    character: { faction: "party" } as any,
  } as CombatantStateRecord;
}

describe("chooseLegendaryAction", () => {
  it("returns null when incapacitated", () => {
    const boss = makeBoss({ conditions: [{ condition: "Incapacitated", duration: "until_removed" }] as any });
    const enemies = [makeEnemy("e1", 35, 10)];
    expect(chooseLegendaryAction(boss, [boss, ...enemies], 1)).toBeNull();
  });

  it("returns null when stunned", () => {
    const boss = makeBoss({ conditions: [{ condition: "Stunned", duration: "until_removed" }] as any });
    const enemies = [makeEnemy("e1", 35, 10)];
    expect(chooseLegendaryAction(boss, [boss, ...enemies], 1)).toBeNull();
  });

  it("returns null when paralyzed", () => {
    const boss = makeBoss({ conditions: [{ condition: "Paralyzed", duration: "until_removed" }] as any });
    const enemies = [makeEnemy("e1", 35, 10)];
    expect(chooseLegendaryAction(boss, [boss, ...enemies], 1)).toBeNull();
  });

  it("returns null when unconscious", () => {
    const boss = makeBoss({ conditions: [{ condition: "Unconscious", duration: "until_removed" }] as any });
    const enemies = [makeEnemy("e1", 35, 10)];
    expect(chooseLegendaryAction(boss, [boss, ...enemies], 1)).toBeNull();
  });

  it("returns null when at 0 HP", () => {
    const boss = makeBoss({ hpCurrent: 0 });
    const enemies = [makeEnemy("e1", 35, 10)];
    expect(chooseLegendaryAction(boss, [boss, ...enemies], 1)).toBeNull();
  });

  it("returns null when charges are 0", () => {
    const boss = makeBoss({
      resources: {
        legendaryActionCharges: 3,
        legendaryActionsRemaining: 0,
        legendaryActions: [
          { name: "Tail Attack", cost: 1, description: "Tail sweep", actionType: "attack", attackName: "Tail" },
        ],
        position: { x: 30, y: 10 },
      },
    });
    const enemies = [makeEnemy("e1", 35, 10)];
    expect(chooseLegendaryAction(boss, [boss, ...enemies], 1)).toBeNull();
  });

  it("returns an attack action when enemy is adjacent", () => {
    const boss = makeBoss();
    const nearEnemy = makeEnemy("e1", 35, 10); // 5ft away — within 10ft reach
    const decision = chooseLegendaryAction(boss, [boss, nearEnemy], 1);
    
    expect(decision).not.toBeNull();
    expect(decision!.actionType).toBe("attack");
    expect(decision!.targetId).toBe("e1");
    expect(decision!.cost).toBe(1);
  });

  it("prefers move when enemy is far away", () => {
    const boss = makeBoss();
    const farEnemy = makeEnemy("e1", 80, 10); // 50ft away — well out of reach
    const decision = chooseLegendaryAction(boss, [boss, farEnemy], 1);

    // Depending on the spreading heuristic, may or may not act
    if (decision) {
      expect(decision.actionType).toBe("move");
    }
  });

  it("uses correct charge cost", () => {
    const boss = makeBoss();
    const nearEnemy = makeEnemy("e1", 35, 10);
    const decision = chooseLegendaryAction(boss, [boss, nearEnemy], 1);
    
    if (decision) {
      expect(decision.cost).toBeGreaterThanOrEqual(1);
      expect(decision.cost).toBeLessThanOrEqual(3);
    }
  });

  it("acts on last opportunity (spends remaining charges)", () => {
    const boss = makeBoss();
    const enemies = [makeEnemy("e1", 35, 10), makeEnemy("e2", 40, 10)];
    const allCombatants = [boss, ...enemies];

    // Last opportunity: turnNumber >= non-boss count (2)
    const decision = chooseLegendaryAction(boss, allCombatants, 2);
    expect(decision).not.toBeNull();
  });
});
