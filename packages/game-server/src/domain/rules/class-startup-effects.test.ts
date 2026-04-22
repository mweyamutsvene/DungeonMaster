import { describe, expect, it } from "vitest";
import { getClassStartupEffects } from "./class-startup-effects.js";

describe("getClassStartupEffects", () => {
  it("returns no effects for an L1 Barbarian", () => {
    expect(getClassStartupEffects({ classId: "barbarian", level: 1 })).toEqual([]);
  });

  it("installs Danger Sense on an L2 Barbarian", () => {
    const effects = getClassStartupEffects({ classId: "barbarian", level: 2 });
    const ds = effects.find(e => e.source === "Danger Sense");
    expect(ds).toBeDefined();
    expect(ds?.type).toBe("advantage");
    expect(ds?.target).toBe("saving_throws");
    expect(ds?.ability).toBe("dexterity");
  });

  it("installs Fast Movement +10 ft at Barbarian L5", () => {
    const effects = getClassStartupEffects({ classId: "barbarian", level: 5 });
    const fm = effects.find(e => e.source === "Fast Movement");
    expect(fm).toBeDefined();
    expect(fm?.type).toBe("speed_modifier");
    expect(fm?.value).toBe(10);
    // L2 Danger Sense should still be present at L5
    expect(effects.find(e => e.source === "Danger Sense")).toBeDefined();
  });

  it("installs Unarmored Movement +10 ft at Monk L2", () => {
    const effects = getClassStartupEffects({ classId: "monk", level: 2 });
    const um = effects.find(e => e.source === "Unarmored Movement");
    expect(um).toBeDefined();
    expect(um?.type).toBe("speed_modifier");
    expect(um?.value).toBe(10);
  });

  it("returns no speed bonus for Monk L1", () => {
    expect(getClassStartupEffects({ classId: "monk", level: 1 })).toEqual([]);
  });

  it("is case-insensitive on classId", () => {
    const effects = getClassStartupEffects({ classId: "Barbarian", level: 2 });
    expect(effects.find(e => e.source === "Danger Sense")).toBeDefined();
  });

  it("returns empty array for unrelated classes", () => {
    expect(getClassStartupEffects({ classId: "wizard", level: 20 })).toEqual([]);
    expect(getClassStartupEffects({ classId: "fighter", level: 5 })).toEqual([]);
  });
});
