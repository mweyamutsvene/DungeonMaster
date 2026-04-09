/**
 * Tests for Lay on Hands executor — pool deduction and validation.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { AbilityRegistry } from "./ability-registry.js";
import { LayOnHandsExecutor } from "./executors/paladin/lay-on-hands-executor.js";
import type { AbilityExecutionContext } from "../../../../domain/abilities/ability-executor.js";

function createMockActor(overrides: Partial<{ id: string; name: string; currentHP: number; maxHP: number }> = {}) {
  return {
    getId: () => overrides.id ?? "paladin-1",
    getName: () => overrides.name ?? "Sir Galahad",
    getCurrentHP: () => overrides.currentHP ?? 10,
    getMaxHP: () => overrides.maxHP ?? 30,
    getSpeed: () => 30,
    modifyHP: () => ({ actualChange: 0 }),
  };
}

function createContext(overrides: Partial<{
  currentHP: number;
  maxHP: number;
  poolCurrent: number;
  poolMax: number;
  level: number;
  className: string;
  bonusActionUsed: boolean;
  targetActor: ReturnType<typeof createMockActor>;
  targetEntityId: string;
  targetPosition: { x: number; y: number };
  actorPosition: { x: number; y: number };
}> = {}): AbilityExecutionContext {
  const {
    currentHP = 10,
    maxHP = 30,
    poolCurrent = 25,
    poolMax = 25,
    level = 5,
    className = "paladin",
    bonusActionUsed = false,
    targetActor,
    targetEntityId,
    targetPosition,
    actorPosition = { x: 0, y: 0 },
  } = overrides;

  const actor = createMockActor({ currentHP, maxHP });

  return {
    sessionId: "test-session",
    encounterId: "test-encounter",
    actor: actor as any,
    combat: {
      hasUsedAction: () => false,
      getRound: () => 1,
      getTurnIndex: () => 0,
      addEffect: () => {},
      getPosition: (id: string) => {
        if (id === "paladin-1") return actorPosition;
        if (targetPosition) return targetPosition;
        return { x: 0, y: 0 };
      },
      setPosition: () => {},
    },
    abilityId: "lay_on_hands",
    target: targetActor as any,
    params: {
      actor: { type: "Character", characterId: "paladin-1" },
      sheet: { level, className },
      resources: {
        bonusActionUsed,
        resourcePools: [{ name: "layOnHands", current: poolCurrent, max: poolMax }],
      },
      ...(targetEntityId ? { targetEntityId } : {}),
    },
    services: {},
  };
}

describe("LayOnHandsExecutor", () => {
  let registry: AbilityRegistry;

  beforeEach(() => {
    registry = new AbilityRegistry();
    registry.register(new LayOnHandsExecutor());
  });

  it("matches lay_on_hands ability ID", () => {
    expect(registry.findExecutor("lay_on_hands")).toBeInstanceOf(LayOnHandsExecutor);
  });

  it("matches class:paladin:lay-on-hands", () => {
    expect(registry.findExecutor("class:paladin:lay-on-hands")).toBeInstanceOf(LayOnHandsExecutor);
  });

  it("heals self and returns correct spendResource for pool deduction", async () => {
    const context = createContext({ currentHP: 10, maxHP: 30, poolCurrent: 25 });
    const result = await registry.execute(context);

    expect(result.success).toBe(true);
    expect(result.data?.spendResource).toEqual({ poolName: "layOnHands", amount: 20 });
    expect(result.data?.hpUpdate).toEqual({ hpCurrent: 30 });
    expect(result.summary).toContain("20 HP");
    expect(result.summary).toContain("5 HP remaining");
  });

  it("caps healing at pool remaining when pool < missing HP", async () => {
    const context = createContext({ currentHP: 5, maxHP: 30, poolCurrent: 10 });
    const result = await registry.execute(context);

    expect(result.success).toBe(true);
    // Missing 25, but pool only has 10
    expect(result.data?.spendResource).toEqual({ poolName: "layOnHands", amount: 10 });
    expect(result.data?.hpUpdate).toEqual({ hpCurrent: 15 });
  });

  it("fails when bonus action is already used", async () => {
    const context = createContext({ bonusActionUsed: true });
    const result = await registry.execute(context);

    expect(result.success).toBe(false);
    expect(result.error).toBe("NO_BONUS_ACTION");
  });

  it("fails when pool is empty", async () => {
    const context = createContext({ poolCurrent: 0 });
    const result = await registry.execute(context);

    expect(result.success).toBe(false);
    expect(result.error).toBe("INSUFFICIENT_USES");
  });

  it("fails when target is at full HP", async () => {
    const context = createContext({ currentHP: 30, maxHP: 30 });
    const result = await registry.execute(context);

    expect(result.success).toBe(false);
    expect(result.error).toBe("FULL_HP");
  });

  it("heals ally when target is in touch range", async () => {
    const ally = createMockActor({ id: "ally-1", name: "Wounded Fighter", currentHP: 5, maxHP: 40 });
    const context = createContext({
      currentHP: 30,
      maxHP: 30,
      poolCurrent: 25,
      targetActor: ally,
      targetEntityId: "ally-1",
      actorPosition: { x: 0, y: 0 },
      targetPosition: { x: 1, y: 0 },
    });

    const result = await registry.execute(context);

    expect(result.success).toBe(true);
    expect(result.data?.spendResource).toEqual({ poolName: "layOnHands", amount: 25 });
    expect(result.data?.targetEntityId).toBe("ally-1");
    expect(result.summary).toContain("Wounded Fighter");
  });

  it("fails when ally is out of touch range", async () => {
    const ally = createMockActor({ id: "ally-1", name: "Far Fighter", currentHP: 5, maxHP: 40 });
    const context = createContext({
      currentHP: 30,
      maxHP: 30,
      targetActor: ally,
      targetEntityId: "ally-1",
      actorPosition: { x: 0, y: 0 },
      targetPosition: { x: 3, y: 0 },
    });

    const result = await registry.execute(context);

    expect(result.success).toBe(false);
    expect(result.error).toBe("OUT_OF_RANGE");
  });

  it("pool amount scales correctly with paladin level (level × 5)", async () => {
    // Level 3 paladin with 15-point pool, missing 20 HP → should heal only 15
    const context = createContext({ level: 3, currentHP: 10, maxHP: 30, poolCurrent: 15, poolMax: 15 });
    const result = await registry.execute(context);

    expect(result.success).toBe(true);
    expect(result.data?.spendResource).toEqual({ poolName: "layOnHands", amount: 15 });
  });
});
