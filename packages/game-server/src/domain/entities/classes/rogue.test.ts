import { describe, expect, it } from "vitest";
import { sneakAttackDiceForLevel, Rogue, ROGUE_COMBAT_TEXT_PROFILE } from "./rogue.js";
import { detectAttackReactions, type AttackReactionInput } from "./combat-text-profile.js";
import { classHasFeature } from "./registry.js";
import { WEAPON_MASTERY, UNCANNY_DODGE, EVASION } from "./feature-keys.js";

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

  it("has uncanny-dodge at level 7", () => {
    expect(classHasFeature("rogue", UNCANNY_DODGE, 7)).toBe(true);
    expect(classHasFeature("rogue", UNCANNY_DODGE, 6)).toBe(false);
  });

  it("has evasion at level 7", () => {
    expect(classHasFeature("rogue", EVASION, 7)).toBe(true);
    expect(classHasFeature("rogue", EVASION, 6)).toBe(false);
  });
});

describe("Uncanny Dodge reaction detection", () => {
  const baseInput: AttackReactionInput = {
    className: "rogue",
    level: 7,
    abilityScores: { strength: 10, dexterity: 16, constitution: 12, intelligence: 10, wisdom: 12, charisma: 8 },
    resources: {},
    hasReaction: true,
    isCharacter: true,
    attackRoll: 18,
    attackerId: "attacker-1",
    targetAC: 15,
  };

  it("detects Uncanny Dodge for level 7+ rogue with reaction available", () => {
    const detected = detectAttackReactions(baseInput, [ROGUE_COMBAT_TEXT_PROFILE]);
    expect(detected).toHaveLength(1);
    expect(detected[0]!.reactionType).toBe("uncanny_dodge");
  });

  it("does not detect Uncanny Dodge when reaction is used", () => {
    const input = { ...baseInput, hasReaction: false };
    const detected = detectAttackReactions(input, [ROGUE_COMBAT_TEXT_PROFILE]);
    expect(detected).toHaveLength(0);
  });

  it("does not detect Uncanny Dodge for rogue below level 7", () => {
    const input = { ...baseInput, level: 6 };
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
