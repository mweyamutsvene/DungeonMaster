import { describe, expect, it } from "vitest";
import {
  Druid,
  DRUID_COMBAT_TEXT_PROFILE,
  createWildShapeState,
  resetWildShapeOnShortRest,
  spendWildShape,
  wildShapeMaxCRForLevel,
  wildShapeUsesForLevel,
} from "./druid.js";

describe("Druid wild shape", () => {
  it("gates uses by level", () => {
    expect(wildShapeUsesForLevel(1)).toBe(0);
    expect(wildShapeUsesForLevel(2)).toBe(2);
    expect(wildShapeUsesForLevel(5)).toBe(2);
  });

  it("computes max CR by level (up to 5)", () => {
    expect(wildShapeMaxCRForLevel(1)).toBe(0);
    expect(wildShapeMaxCRForLevel(2)).toBe(0.25);
    expect(wildShapeMaxCRForLevel(4)).toBe(0.5);
    expect(wildShapeMaxCRForLevel(5)).toBe(0.5);
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
    expect(ws.effect).toContain("CR 0.25");
  });

  it("reflects CR scaling at level 4 and 8", () => {
    const capsL4 = Druid.capabilitiesForLevel!(4);
    const wsL4 = capsL4.find(c => c.name === "Wild Shape")!;
    expect(wsL4.effect).toContain("CR 0.5");

    const capsL8 = Druid.capabilitiesForLevel!(8);
    const wsL8 = capsL8.find(c => c.name === "Wild Shape")!;
    expect(wsL8.effect).toContain("CR 1");
  });
});

describe("DRUID_COMBAT_TEXT_PROFILE", () => {
  it("has classId druid", () => {
    expect(DRUID_COMBAT_TEXT_PROFILE.classId).toBe("druid");
  });

  it("maps wild-shape keyword", () => {
    const mapping = DRUID_COMBAT_TEXT_PROFILE.actionMappings[0];
    expect(mapping.keyword).toBe("wild-shape");
    expect(mapping.abilityId).toBe("class:druid:wild-shape");
    expect(mapping.category).toBe("bonusAction");
  });

  it("matches wildshape patterns", () => {
    const patterns = DRUID_COMBAT_TEXT_PROFILE.actionMappings[0].normalizedPatterns;
    expect("wildshape").toMatch(patterns[0]);
    expect("usewildshape").toMatch(patterns[0]);
  });

  it("has empty attackEnhancements", () => {
    expect(DRUID_COMBAT_TEXT_PROFILE.attackEnhancements).toEqual([]);
  });
});
