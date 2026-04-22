import { describe, expect, it } from "vitest";
import {
  createSorceryPointsState,
  resetSorceryPointsOnLongRest,
  Sorcerer,
  SORCERER_COMBAT_TEXT_PROFILE,
  sorceryPointsForLevel,
  spendSorceryPoints,
} from "./sorcerer.js";
import { tryMatchClassAction } from "./combat-text-profile.js";

describe("Sorcerer sorcery points", () => {
  it("computes sorcery points by level", () => {
    expect(sorceryPointsForLevel(1)).toBe(0);
    expect(sorceryPointsForLevel(2)).toBe(2);
    expect(sorceryPointsForLevel(10)).toBe(10);
    expect(sorceryPointsForLevel(20)).toBe(20);
  });

  it("spends and resets sorcery points", () => {
    let s = createSorceryPointsState(6);
    expect(s.pool.current).toBe(6);

    s = spendSorceryPoints(s, 5);
    expect(s.pool.current).toBe(1);

    s = resetSorceryPointsOnLongRest(6, s);
    expect(s.pool.current).toBe(6);
    expect(s.pool.max).toBe(6);
  });
});

describe("Sorcerer capabilitiesForLevel", () => {
  it("returns only Spellcasting at level 1", () => {
    const caps = Sorcerer.capabilitiesForLevel!(1);
    expect(caps).toHaveLength(1);
    expect(caps[0].name).toBe("Spellcasting");
    expect(caps[0].economy).toBe("action");
  });

  it("returns Sorcery Points and Metamagic at level 2", () => {
    const caps = Sorcerer.capabilitiesForLevel!(2);
    expect(caps).toHaveLength(3);
    const names = caps.map((c) => c.name);
    expect(names).toContain("Spellcasting");
    expect(names).toContain("Sorcery Points");
    expect(names).toContain("Metamagic");
  });

  it("Sorcery Points cost reflects level", () => {
    const caps = Sorcerer.capabilitiesForLevel!(10);
    const sp = caps.find((c) => c.name === "Sorcery Points");
    expect(sp?.cost).toBe("10 points/long rest");
  });
});

describe("Sorcerer features map", () => {
  it("grants spellcasting at level 1", () => {
    expect(Sorcerer.features?.["spellcasting"]).toBe(1);
  });

  it("grants sorcery-points at level 2", () => {
    expect(Sorcerer.features?.["sorcery-points"]).toBe(2);
  });

  it("grants metamagic at level 2", () => {
    expect(Sorcerer.features?.["metamagic"]).toBe(2);
  });
});

describe("SORCERER_COMBAT_TEXT_PROFILE", () => {
  it("has classId sorcerer", () => {
    expect(SORCERER_COMBAT_TEXT_PROFILE.classId).toBe("sorcerer");
  });

  it("matches quickened-spell patterns", () => {
    const match = tryMatchClassAction("quicken", [SORCERER_COMBAT_TEXT_PROFILE]);
    expect(match).not.toBeNull();
    expect(match!.abilityId).toBe("class:sorcerer:quickened-spell");
  });

  it("matches twinned-spell patterns", () => {
    const match = tryMatchClassAction("twin", [SORCERER_COMBAT_TEXT_PROFILE]);
    expect(match).not.toBeNull();
    expect(match!.abilityId).toBe("class:sorcerer:twinned-spell");
  });

  it("has empty attackEnhancements", () => {
    expect(SORCERER_COMBAT_TEXT_PROFILE.attackEnhancements).toEqual([]);
  });
});


import { classHasFeature as __chf_sc, hasFeature as __hf_sc } from "./registry.js";
import { DRACONIC_RESILIENCE, INNATE_SORCERY } from "./feature-keys.js";
import { describe as __d_sc, it as __i_sc, expect as __e_sc } from "vitest";
__d_sc("Sorcerer with Draconic Sorcery (Red) subclass", () => {
  __i_sc("exposes both base Innate Sorcery (L1) and subclass Draconic Resilience (L1)", () => {
    const classLevels = [{ classId: "sorcerer", level: 1 }];
    __e_sc(__hf_sc(classLevels, INNATE_SORCERY)).toBe(true);
    __e_sc(__chf_sc("sorcerer", DRACONIC_RESILIENCE, 1, "draconic-sorcery-red")).toBe(true);
    __e_sc(__chf_sc("sorcerer", DRACONIC_RESILIENCE, 1)).toBe(false);
  });
});