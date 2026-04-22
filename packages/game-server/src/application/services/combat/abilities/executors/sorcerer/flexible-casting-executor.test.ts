import { describe, it, expect } from "vitest";
import { FlexibleCastingExecutor, SP_TO_SLOT_COST } from "./flexible-casting-executor.js";
import type { AbilityExecutionContext } from "../../../../../../domain/abilities/ability-executor.js";

const baseActor = {
  getId: () => "actor-1",
  getName: () => "Vaelen",
  getCurrentHP: () => 30,
  getMaxHP: () => 30,
  getSpeed: () => 30,
  modifyHP: (amount: number) => ({ actualChange: amount }),
};

const baseCombat = {
  hasUsedAction: () => false,
  getRound: () => 1,
  getTurnIndex: () => 0,
  addEffect: () => {},
  getPosition: () => undefined,
  setPosition: () => {},
};

function buildContext(params: Record<string, unknown>): AbilityExecutionContext {
  return {
    sessionId: "s",
    encounterId: "e",
    actor: baseActor,
    combat: baseCombat,
    abilityId: "class:sorcerer:flexible-casting",
    params,
    services: {},
  };
}

function makeResources(spCurrent: number, slot3Current: number, slot2Current = 3) {
  return {
    resourcePools: [
      { name: "sorceryPoints", current: spCurrent, max: 5 },
      { name: "spellSlot_2", current: slot2Current, max: 3 },
      { name: "spellSlot_3", current: slot3Current, max: 2 },
    ],
  };
}

describe("FlexibleCastingExecutor", () => {
  const exec = new FlexibleCastingExecutor();

  it("converts 5 SP → level 3 slot (costs 5 per RAW 2024 table)", async () => {
    const res = await exec.execute(buildContext({
      sheet: { level: 5 },
      className: "sorcerer",
      level: 5,
      resources: makeResources(5, 0),
      text: "convert 5 sorcery points to a level 3 spell slot",
    }));
    expect(res.success).toBe(true);
    const updated = (res.data?.updatedResources as any).resourcePools;
    expect(updated.find((p: any) => p.name === "sorceryPoints").current).toBe(0);
    expect(updated.find((p: any) => p.name === "spellSlot_3").current).toBe(1);
  });

  it("converts level 2 slot → 2 SP (slot level = SP yield)", async () => {
    const res = await exec.execute(buildContext({
      sheet: { level: 5 },
      className: "sorcerer",
      level: 5,
      resources: makeResources(0, 0, 3),
      text: "convert a level 2 spell slot to sorcery points",
    }));
    expect(res.success).toBe(true);
    const updated = (res.data?.updatedResources as any).resourcePools;
    expect(updated.find((p: any) => p.name === "sorceryPoints").current).toBe(2);
    expect(updated.find((p: any) => p.name === "spellSlot_2").current).toBe(2);
  });

  it("rejects SP → slot when insufficient sorcery points", async () => {
    const res = await exec.execute(buildContext({
      sheet: { level: 5 },
      className: "sorcerer",
      level: 5,
      resources: makeResources(2, 0),
      text: "convert 2 sorcery points to a level 3 spell slot",
    }));
    expect(res.success).toBe(false);
    expect(res.error).toBe("INSUFFICIENT_RESOURCES");
  });

  it("rejects slot → SP when no slot of that level is available", async () => {
    const res = await exec.execute(buildContext({
      sheet: { level: 5 },
      className: "sorcerer",
      level: 5,
      resources: makeResources(0, 0, 0),
      text: "convert a level 2 spell slot to sorcery points",
    }));
    expect(res.success).toBe(false);
    expect(res.error).toBe("INSUFFICIENT_RESOURCES");
  });

  it("requires FLEXIBLE_CASTING feature (L2 Sorcerer)", async () => {
    const res = await exec.execute(buildContext({
      sheet: { level: 1 },
      className: "sorcerer",
      level: 1,
      resources: makeResources(5, 0),
      text: "convert 2 sorcery points to a level 1 spell slot",
    }));
    expect(res.success).toBe(false);
    expect(res.error).toBe("MISSING_FEATURE");
  });

  it("SP_TO_SLOT_COST matches RAW 2024 table", () => {
    expect(SP_TO_SLOT_COST[1]).toBe(2);
    expect(SP_TO_SLOT_COST[2]).toBe(3);
    expect(SP_TO_SLOT_COST[3]).toBe(5);
    expect(SP_TO_SLOT_COST[4]).toBe(6);
    expect(SP_TO_SLOT_COST[5]).toBe(7);
  });
});
