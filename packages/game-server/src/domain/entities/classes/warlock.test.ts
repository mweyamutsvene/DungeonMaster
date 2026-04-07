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

  it("returns Eldritch Invocations at level 2", () => {
    const caps = Warlock.capabilitiesForLevel!(2);
    expect(caps).toHaveLength(2);
    expect(caps.map(c => c.name)).toContain("Eldritch Invocations");
  });

  it("returns Pact Boon at level 3", () => {
    const caps = Warlock.capabilitiesForLevel!(3);
    expect(caps).toHaveLength(3);
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
