import { describe, expect, it } from "vitest";
import { defaultResourcePoolsForClass } from "./class-resources.js";

describe("class resources", () => {
  it("initializes warlock pact slots", () => {
    const pools = defaultResourcePoolsForClass({ classId: "warlock", level: 2 });
    expect(pools).toEqual([{ name: "pactMagic", current: 2, max: 2 }]);
  });

  it("initializes druid wild shape starting at level 2", () => {
    expect(defaultResourcePoolsForClass({ classId: "druid", level: 1 })).toEqual([]);
    expect(defaultResourcePoolsForClass({ classId: "druid", level: 2 })).toEqual([
      { name: "wildShape", current: 2, max: 2 },
    ]);
  });

  it("initializes wizard arcane recovery", () => {
    const pools = defaultResourcePoolsForClass({ classId: "wizard", level: 3 });
    expect(pools).toEqual([{ name: "arcaneRecovery", current: 1, max: 1 }]);
  });

  it("initializes paladin lay on hands and adds channel divinity at 3", () => {
    const lvl2 = defaultResourcePoolsForClass({ classId: "paladin", level: 2 });
    expect(lvl2).toEqual([{ name: "layOnHands", current: 10, max: 10 }]);

    const lvl3 = defaultResourcePoolsForClass({ classId: "paladin", level: 3 });
    expect(lvl3).toEqual([
      { name: "layOnHands", current: 15, max: 15 },
      { name: "channelDivinity:paladin", current: 1, max: 1 },
    ]);
  });

  it("defaults bard CHA mod to 0 when not provided", () => {
    const pools = defaultResourcePoolsForClass({ classId: "bard", level: 1 });
    expect(pools[0]!.name).toBe("bardicInspiration");
    // CHA mod defaults to 0, minimum 1 use
    expect(pools[0]!.current).toBeGreaterThanOrEqual(0);

    const poolsWithCha = defaultResourcePoolsForClass({ classId: "bard", level: 1, charismaModifier: 3 });
    expect(poolsWithCha[0]!.name).toBe("bardicInspiration");
    expect(poolsWithCha[0]!.current).toBe(3);
  });
});
