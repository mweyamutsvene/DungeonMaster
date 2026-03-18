import { describe, expect, it } from "vitest";
import { refreshClassResourcePools } from "./rest.js";

describe("rest resource refresh", () => {
  it("refreshes barbarian rage only on long rest", () => {
    const pools = [{ name: "rage", current: 0, max: 2 }];

    const shortRest = refreshClassResourcePools({
      classId: "barbarian",
      level: 1,
      rest: "short",
      pools,
    });
    expect(shortRest[0]!.current).toBe(0);

    const longRest = refreshClassResourcePools({
      classId: "barbarian",
      level: 1,
      rest: "long",
      pools,
    });
    expect(longRest[0]!.current).toBe(2);
    expect(longRest[0]!.max).toBe(2);
  });

  it("refreshes monk ki on short rest", () => {
    const pools = [{ name: "ki", current: 1, max: 5 }];
    const refreshed = refreshClassResourcePools({
      classId: "monk",
      level: 5,
      rest: "short",
      pools,
    });
    expect(refreshed[0]!.current).toBe(5);
    expect(refreshed[0]!.max).toBe(5);
  });

  it("refreshes warlock pact slots on short rest", () => {
    const pools = [{ name: "pactMagic", current: 0, max: 2 }];
    const refreshed = refreshClassResourcePools({
      classId: "warlock",
      level: 2,
      rest: "short",
      pools,
    });
    expect(refreshed[0]!.current).toBe(2);
    expect(refreshed[0]!.max).toBe(2);
  });

  it("refreshes bardic inspiration on long rest and on short rest at level 5+", () => {
    const pools = [{ name: "bardicInspiration", current: 0, max: 3 }];

    const shortRestAt4 = refreshClassResourcePools({
      classId: "bard",
      level: 4,
      rest: "short",
      pools,
      charismaModifier: 3,
    });
    expect(shortRestAt4[0]!.current).toBe(0);

    const shortRestAt5 = refreshClassResourcePools({
      classId: "bard",
      level: 5,
      rest: "short",
      pools,
      charismaModifier: 3,
    });
    expect(shortRestAt5[0]!.current).toBe(3);

    const longRest = refreshClassResourcePools({
      classId: "bard",
      level: 4,
      rest: "long",
      pools,
      charismaModifier: 3,
    });
    expect(longRest[0]!.current).toBe(3);
  });

  it("refreshes cleric channel divinity on short rest (2024 rules)", () => {
    const pools = [{ name: "channelDivinity", current: 0, max: 3 }];
    const refreshed = refreshClassResourcePools({
      classId: "cleric",
      level: 6,
      rest: "short",
      pools,
    });
    expect(refreshed[0]!.current).toBe(3);
    expect(refreshed[0]!.max).toBe(3);
  });

  it("refreshes druid wild shape on short rest", () => {
    const pools = [{ name: "wildShape", current: 0, max: 2 }];
    const refreshed = refreshClassResourcePools({
      classId: "druid",
      level: 2,
      rest: "short",
      pools,
    });
    expect(refreshed[0]!.current).toBe(2);
    expect(refreshed[0]!.max).toBe(2);
  });

  it("refreshes wizard arcane recovery only on long rest", () => {
    const pools = [{ name: "arcaneRecovery", current: 0, max: 1 }];

    const shortRest = refreshClassResourcePools({
      classId: "wizard",
      level: 3,
      rest: "short",
      pools,
    });
    expect(shortRest[0]!.current).toBe(0);

    const longRest = refreshClassResourcePools({
      classId: "wizard",
      level: 3,
      rest: "long",
      pools,
    });
    expect(longRest[0]!.current).toBe(1);
    expect(longRest[0]!.max).toBe(1);
  });

  it("refreshes paladin lay on hands only on long rest", () => {
    const pools = [{ name: "layOnHands", current: 3, max: 10 }];

    const shortRest = refreshClassResourcePools({
      classId: "paladin",
      level: 2,
      rest: "short",
      pools,
    });
    expect(shortRest[0]!.current).toBe(3);

    const longRest = refreshClassResourcePools({
      classId: "paladin",
      level: 2,
      rest: "long",
      pools,
    });
    expect(longRest[0]!.current).toBe(10);
    expect(longRest[0]!.max).toBe(10);
  });
});
