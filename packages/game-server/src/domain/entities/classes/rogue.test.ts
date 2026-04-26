import { describe, expect, it } from "vitest";
import { sneakAttackDiceForLevel, parseCunningStrikeOption, Rogue, ROGUE_COMBAT_TEXT_PROFILE } from "./rogue.js";
import { detectAttackReactions, type AttackReactionInput } from "./combat-text-profile.js";
import { classHasFeature } from "./registry.js";
import { WEAPON_MASTERY, UNCANNY_DODGE, EVASION } from "./feature-keys.js";

describe("parseCunningStrikeOption", () => {
  it("parses existing options: poison, trip, withdraw", () => {
    expect(parseCunningStrikeOption("cunning strike poison")).toBe("poison");
    expect(parseCunningStrikeOption("cunning strike trip")).toBe("trip");
    expect(parseCunningStrikeOption("cunning strike withdraw")).toBe("withdraw");
    expect(parseCunningStrikeOption("cunning-strike: trip")).toBe("trip");
  });

  it("parses disarm (1d SA cost)", () => {
    expect(parseCunningStrikeOption("cunning strike disarm")).toBe("disarm");
    expect(parseCunningStrikeOption("cunning-strike: disarm")).toBe("disarm");
    expect(parseCunningStrikeOption("cunning-strike disarm")).toBe("disarm");
  });

  it("parses daze (2d SA cost)", () => {
    expect(parseCunningStrikeOption("cunning strike daze")).toBe("daze");
    expect(parseCunningStrikeOption("cunning-strike daze")).toBe("daze");
    expect(parseCunningStrikeOption("cunning-strike: daze")).toBe("daze");
  });

  it("returns null when no cunning strike option present", () => {
    expect(parseCunningStrikeOption("attack goblin with shortsword")).toBeNull();
    expect(parseCunningStrikeOption("sneak attack")).toBeNull();
    expect(parseCunningStrikeOption("")).toBeNull();
  });
});

describe("Rogue sneak attack", () => {
  it("scales sneak attack dice by level", () => {
    expect(sneakAttackDiceForLevel(1)).toBe(1);
    expect(sneakAttackDiceForLevel(2)).toBe(1);
    expect(sneakAttackDiceForLevel(3)).toBe(2);
    expect(sneakAttackDiceForLevel(5)).toBe(3);
    expect(sneakAttackDiceForLevel(19)).toBe(10);
    expect(sneakAttackDiceForLevel(20)).toBe(10);
  });
});

describe("Rogue feature keys", () => {
  it("has weapon-mastery at level 1", () => {
    expect(classHasFeature("rogue", WEAPON_MASTERY, 1)).toBe(true);
  });

  it("has uncanny-dodge at level 5", () => {
    expect(classHasFeature("rogue", UNCANNY_DODGE, 5)).toBe(true);
    expect(classHasFeature("rogue", UNCANNY_DODGE, 4)).toBe(false);
  });

  it("has evasion at level 7", () => {
    expect(classHasFeature("rogue", EVASION, 7)).toBe(true);
    expect(classHasFeature("rogue", EVASION, 6)).toBe(false);
  });
});

describe("Uncanny Dodge reaction detection", () => {
  const baseInput: AttackReactionInput = {
    className: "rogue",
    level: 5,
    abilityScores: { strength: 10, dexterity: 16, constitution: 12, intelligence: 10, wisdom: 12, charisma: 8 },
    resources: {},
    hasReaction: true,
    isCharacter: true,
    attackRoll: 18,
    attackerId: "attacker-1",
    targetAC: 15,
  };

  it("detects Uncanny Dodge for level 5+ rogue with reaction available", () => {
    const detected = detectAttackReactions(baseInput, [ROGUE_COMBAT_TEXT_PROFILE]);
    expect(detected).toHaveLength(1);
    expect(detected[0]!.reactionType).toBe("uncanny_dodge");
  });

  it("does not detect Uncanny Dodge when reaction is used", () => {
    const input = { ...baseInput, hasReaction: false };
    const detected = detectAttackReactions(input, [ROGUE_COMBAT_TEXT_PROFILE]);
    expect(detected).toHaveLength(0);
  });

  it("does not detect Uncanny Dodge for rogue below level 5", () => {
    const input = { ...baseInput, level: 4 };
    const detected = detectAttackReactions(input, [ROGUE_COMBAT_TEXT_PROFILE]);
    expect(detected).toHaveLength(0);
  });

  it("does not detect Uncanny Dodge for non-rogue", () => {
    const input = { ...baseInput, className: "fighter" };
    const detected = detectAttackReactions(input, [ROGUE_COMBAT_TEXT_PROFILE]);
    expect(detected).toHaveLength(0);
  });

  it("does not detect Uncanny Dodge for monsters", () => {
    const input = { ...baseInput, isCharacter: false };
    const detected = detectAttackReactions(input, [ROGUE_COMBAT_TEXT_PROFILE]);
    expect(detected).toHaveLength(0);
  });
});
