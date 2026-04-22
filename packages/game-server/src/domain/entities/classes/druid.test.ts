import { describe, expect, it } from "vitest";
import {
  Druid,
  DRUID_COMBAT_TEXT_PROFILE,
  createWildShapeState,
  resetWildShapeOnShortRest,
  spendWildShape,
  wildShapeUsesForLevel,
  availableBeastForms,
  getBeastFormStatBlock,
} from "./druid.js";

describe("Druid wild shape", () => {
  it("gates uses by level (scales with proficiency bonus in 2024)", () => {
    expect(wildShapeUsesForLevel(1)).toBe(0);
    expect(wildShapeUsesForLevel(2)).toBe(2);
    expect(wildShapeUsesForLevel(5)).toBe(3);
    expect(wildShapeUsesForLevel(9)).toBe(4);
    expect(wildShapeUsesForLevel(13)).toBe(5);
    expect(wildShapeUsesForLevel(17)).toBe(6);
  });

  it("unlocks beast forms by level", () => {
    expect(availableBeastForms(1)).toEqual([]);
    expect(availableBeastForms(2)).toEqual(["Beast of the Land"]);
    expect(availableBeastForms(4)).toEqual(["Beast of the Land", "Beast of the Sea"]);
    expect(availableBeastForms(8)).toEqual(["Beast of the Land", "Beast of the Sea", "Beast of the Sky"]);
  });

  it("scales beast form stat blocks with druid level", () => {
    const land2 = getBeastFormStatBlock("Beast of the Land", 2);
    expect(land2.hp).toBe(10); // 5 * 2
    expect(land2.multiattack).toBe(false);

    const land5 = getBeastFormStatBlock("Beast of the Land", 5);
    expect(land5.hp).toBe(25); // 5 * 5
    expect(land5.multiattack).toBe(true);

    const sky10 = getBeastFormStatBlock("Beast of the Sky", 10);
    expect(sky10.hp).toBe(50); // 5 * 10
    expect(sky10.speed).toContain("fly");
  });

  it("spends and resets on short rest", () => {
    let s = createWildShapeState(2);
    expect(s.pool.current).toBe(2);

    s = spendWildShape(s, 1);
    expect(s.pool.current).toBe(1);

    s = resetWildShapeOnShortRest(2, s);
    expect(s.pool.current).toBe(2);
    expect(s.pool.max).toBe(2);
  });
});

describe("Druid capabilitiesForLevel", () => {
  it("returns only Spellcasting at level 1", () => {
    const caps = Druid.capabilitiesForLevel!(1);
    expect(caps).toHaveLength(1);
    expect(caps[0].name).toBe("Spellcasting");
    expect(caps[0].economy).toBe("action");
  });

  it("returns Spellcasting + Wild Shape at level 2", () => {
    const caps = Druid.capabilitiesForLevel!(2);
    expect(caps).toHaveLength(2);

    const ws = caps.find(c => c.name === "Wild Shape")!;
    expect(ws.economy).toBe("bonusAction");
    expect(ws.abilityId).toBe("class:druid:wild-shape");
    expect(ws.resourceCost).toEqual({ pool: "wildShape", amount: 1 });
    expect(ws.effect).toContain("Beast of the Land");
  });

  it("reflects beast form availability at level 4 and 8", () => {
    const capsL4 = Druid.capabilitiesForLevel!(4);
    const wsL4 = capsL4.find(c => c.name === "Wild Shape")!;
    expect(wsL4.effect).toContain("Beast of the Sea");

    const capsL8 = Druid.capabilitiesForLevel!(8);
    const wsL8 = capsL8.find(c => c.name === "Wild Shape")!;
    expect(wsL8.effect).toContain("Beast of the Sky");
  });
});

describe("DRUID_COMBAT_TEXT_PROFILE", () => {
  it("has classId druid", () => {
    expect(DRUID_COMBAT_TEXT_PROFILE.classId).toBe("druid");
  });

  it("maps wild-shape keyword", () => {
    const mapping = DRUID_COMBAT_TEXT_PROFILE.actionMappings.find((m) => m.keyword === "wild-shape");
    expect(mapping).toBeDefined();
    expect(mapping!.abilityId).toBe("class:druid:wild-shape");
    expect(mapping!.category).toBe("bonusAction");
  });

  it("matches wildshape patterns", () => {
    const mapping = DRUID_COMBAT_TEXT_PROFILE.actionMappings.find((m) => m.keyword === "wild-shape");
    expect(mapping).toBeDefined();
    const patterns = mapping!.normalizedPatterns;
    expect("wildshape").toMatch(patterns[0]);
    expect("usewildshape").toMatch(patterns[0]);
  });

  it("has empty attackEnhancements", () => {
    expect(DRUID_COMBAT_TEXT_PROFILE.attackEnhancements).toEqual([]);
  });
});


import { classHasFeature as __chf_dr, hasFeature as __hf_dr } from "./registry.js";
import { CIRCLE_SPELLS, WILD_SHAPE } from "./feature-keys.js";
import { describe as __d_dr, it as __i_dr, expect as __e_dr } from "vitest";
__d_dr("Druid with Circle of the Land (Grassland) subclass", () => {
  __i_dr("exposes both base Wild Shape (L2) and subclass Circle Spells (L3)", () => {
    const classLevels = [{ classId: "druid", level: 3 }];
    __e_dr(__hf_dr(classLevels, WILD_SHAPE)).toBe(true);
    __e_dr(__chf_dr("druid", CIRCLE_SPELLS, 3, "circle-of-the-land-grassland")).toBe(true);
    __e_dr(__chf_dr("druid", CIRCLE_SPELLS, 3)).toBe(false);
  });
});