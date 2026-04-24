import { describe, expect, it } from "vitest";
import {
  createPactMagicState,
  pactMagicSlotsForLevel,
  resetPactMagicOnShortRest,
  spendPactMagicSlot,
  Warlock,
  WARLOCK_COMBAT_TEXT_PROFILE,
} from "./warlock.js";
import { tryMatchClassAction } from "./combat-text-profile.js";

describe("Warlock pact magic", () => {
  it("computes pact slots by level", () => {
    expect(pactMagicSlotsForLevel(1)).toEqual({ slotLevel: 1, slots: 1 });
    expect(pactMagicSlotsForLevel(2)).toEqual({ slotLevel: 1, slots: 2 });
    expect(pactMagicSlotsForLevel(3)).toEqual({ slotLevel: 2, slots: 2 });
    expect(pactMagicSlotsForLevel(5)).toEqual({ slotLevel: 3, slots: 2 });
    expect(pactMagicSlotsForLevel(9)).toEqual({ slotLevel: 5, slots: 2 });
    expect(pactMagicSlotsForLevel(11)).toEqual({ slotLevel: 5, slots: 3 });
    expect(pactMagicSlotsForLevel(17)).toEqual({ slotLevel: 5, slots: 4 });
  });

  it("spends and resets on short rest", () => {
    let s = createPactMagicState(2);
    expect(s.pool.current).toBe(2);
    expect(s.slotLevel).toBe(1);

    s = spendPactMagicSlot(s, 1);
    expect(s.pool.current).toBe(1);

    s = resetPactMagicOnShortRest(2, s);
    expect(s.pool.current).toBe(2);
    expect(s.pool.max).toBe(2);
    expect(s.slotLevel).toBe(1);
  });
});

describe("Warlock capabilitiesForLevel", () => {
  it("returns Pact Magic at level 1", () => {
    const caps = Warlock.capabilitiesForLevel!(1);
    expect(caps).toHaveLength(1);
    expect(caps[0].name).toBe("Pact Magic");
  });

  it("returns Eldritch Invocations + Magical Cunning at level 2", () => {
    const caps = Warlock.capabilitiesForLevel!(2);
    expect(caps).toHaveLength(3);
    const names = caps.map(c => c.name);
    expect(names).toContain("Eldritch Invocations");
    expect(names).toContain("Magical Cunning");
  });

  it("returns Pact Boon at level 3", () => {
    const caps = Warlock.capabilitiesForLevel!(3);
    expect(caps).toHaveLength(4);
    expect(caps.map(c => c.name)).toContain("Pact Boon");
  });

  it("does not include Pact Boon at level 2", () => {
    const caps = Warlock.capabilitiesForLevel!(2);
    expect(caps.map(c => c.name)).not.toContain("Pact Boon");
  });
});

describe("Warlock features map", () => {
  it("has pact-magic at level 1", () => {
    expect(Warlock.features!["pact-magic"]).toBe(1);
  });

  it("has eldritch-invocations at level 2", () => {
    expect(Warlock.features!["eldritch-invocations"]).toBe(2);
  });

  it("has pact-boon at level 3", () => {
    expect(Warlock.features!["pact-boon"]).toBe(3);
  });
});

describe("Warlock combat text profile", () => {
  it("does not match eldritch blast (spell, not class ability)", () => {
    const match = tryMatchClassAction("eldritch blast", [WARLOCK_COMBAT_TEXT_PROFILE]);
    expect(match).toBeNull();
  });

  it("does not match 'cast eldritch blast' (spell, not class ability)", () => {
    const match = tryMatchClassAction("cast eldritch blast", [WARLOCK_COMBAT_TEXT_PROFILE]);
    expect(match).toBeNull();
  });

  it("does not match unrelated text", () => {
    const match = tryMatchClassAction("attack with sword", [WARLOCK_COMBAT_TEXT_PROFILE]);
    expect(match).toBeNull();
  });

  it("has Hellish Rebuke damage reaction", () => {
    expect(WARLOCK_COMBAT_TEXT_PROFILE.damageReactions).toHaveLength(1);
    expect(WARLOCK_COMBAT_TEXT_PROFILE.damageReactions![0].reactionType).toBe("hellish_rebuke");
  });
});


import { classHasFeature as __chf_wl, hasFeature as __hf_wl } from "./registry.js";
import { DARK_ONES_BLESSING, PACT_BOON } from "./feature-keys.js";
import { describe as __d_wl, it as __i_wl, expect as __e_wl } from "vitest";
__d_wl("Warlock with The Fiend subclass", () => {
  __i_wl("exposes both base Pact Boon (L3) and subclass Dark One's Blessing (L3)", () => {
    const classLevels = [{ classId: "warlock", level: 3 }];
    __e_wl(__hf_wl(classLevels, PACT_BOON)).toBe(true);
    __e_wl(__chf_wl("warlock", DARK_ONES_BLESSING, 3, "the-fiend")).toBe(true);
    __e_wl(__chf_wl("warlock", DARK_ONES_BLESSING, 3)).toBe(false);
  });
});

import {
  AGONIZING_BLAST_INVOCATION,
  agonizingBlastBeamBonus,
  darkOnesBlessingTempHp,
  hasAgonizingBlast,
  qualifiesForDarkOnesBlessing,
} from "./warlock.js";

describe("Agonizing Blast invocation", () => {
  it("exports canonical name constant", () => {
    expect(AGONIZING_BLAST_INVOCATION).toBe("Agonizing Blast");
  });

  it("detects invocation case-insensitively", () => {
    expect(hasAgonizingBlast(["Agonizing Blast"])).toBe(true);
    expect(hasAgonizingBlast(["agonizing blast"])).toBe(true);
    expect(hasAgonizingBlast(["AGONIZING BLAST", "Devil's Sight"])).toBe(true);
  });

  it("returns false when invocation absent", () => {
    expect(hasAgonizingBlast(undefined)).toBe(false);
    expect(hasAgonizingBlast([])).toBe(false);
    expect(hasAgonizingBlast(["Devil's Sight", "Repelling Blast"])).toBe(false);
  });

  it("returns CHA mod when invocation present, else 0", () => {
    expect(agonizingBlastBeamBonus(["Agonizing Blast"], 4)).toBe(4);
    expect(agonizingBlastBeamBonus(["Agonizing Blast"], 0)).toBe(0);
    expect(agonizingBlastBeamBonus(undefined, 4)).toBe(0);
    expect(agonizingBlastBeamBonus([], 4)).toBe(0);
    expect(agonizingBlastBeamBonus(["Devil's Sight"], 4)).toBe(0);
  });

  it("clamps negative CHA modifier to 0", () => {
    expect(agonizingBlastBeamBonus(["Agonizing Blast"], -1)).toBe(0);
  });
});

describe("Dark One's Blessing (Fiend Warlock)", () => {
  it("computes CHA mod + warlock level (min 1)", () => {
    expect(darkOnesBlessingTempHp(3, 5)).toBe(8);
    expect(darkOnesBlessingTempHp(0, 3)).toBe(3);
    expect(darkOnesBlessingTempHp(-5, 3)).toBe(1); // clamp min 1
    expect(darkOnesBlessingTempHp(4, 20)).toBe(24);
  });

  it("qualifies Fiend Warlock L3+ via single-class sheet", () => {
    const sheet = {
      className: "warlock",
      level: 3,
      subclass: "The Fiend",
      abilityScores: { charisma: 16 },
    };
    const result = qualifiesForDarkOnesBlessing(sheet);
    expect(result).toEqual({ warlockLevel: 3, chaMod: 3 });
  });

  it("qualifies via classLevels multi-class representation", () => {
    const sheet = {
      classLevels: [
        { classId: "warlock", level: 5, subclass: "the-fiend" },
        { classId: "sorcerer", level: 1 },
      ],
      abilityScores: { charisma: 18 },
    };
    const result = qualifiesForDarkOnesBlessing(sheet);
    expect(result).toEqual({ warlockLevel: 5, chaMod: 4 });
  });

  it("rejects warlocks below level 3", () => {
    const sheet = {
      className: "warlock",
      level: 2,
      subclass: "The Fiend",
      abilityScores: { charisma: 16 },
    };
    expect(qualifiesForDarkOnesBlessing(sheet)).toBeNull();
  });

  it("rejects warlocks of other subclasses", () => {
    const sheet = {
      className: "warlock",
      level: 5,
      subclass: "The Great Old One",
      abilityScores: { charisma: 16 },
    };
    expect(qualifiesForDarkOnesBlessing(sheet)).toBeNull();
  });

  it("rejects non-warlock classes", () => {
    const sheet = {
      className: "sorcerer",
      level: 5,
      subclass: "The Fiend",
      abilityScores: { charisma: 16 },
    };
    expect(qualifiesForDarkOnesBlessing(sheet)).toBeNull();
  });

  it("returns null for null/undefined sheet", () => {
    expect(qualifiesForDarkOnesBlessing(null)).toBeNull();
    expect(qualifiesForDarkOnesBlessing(undefined)).toBeNull();
  });

  it("accepts 'Fiend' and 'fiend' variants of subclass", () => {
    const base = { className: "warlock", level: 3, abilityScores: { charisma: 14 } };
    expect(qualifiesForDarkOnesBlessing({ ...base, subclass: "Fiend" })).not.toBeNull();
    expect(qualifiesForDarkOnesBlessing({ ...base, subclass: "fiend" })).not.toBeNull();
    expect(qualifiesForDarkOnesBlessing({ ...base, subclass: "the-fiend" })).not.toBeNull();
  });
});