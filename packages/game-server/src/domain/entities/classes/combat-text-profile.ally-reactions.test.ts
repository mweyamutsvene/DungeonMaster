import { describe, it, expect } from "vitest";

import {
  detectAllyAttackReactions,
  detectAttackReactions,
  type AttackReactionInput,
} from "./combat-text-profile.js";
import { FIGHTER_COMBAT_TEXT_PROFILE } from "./fighter.js";

function baseInput(overrides: Partial<AttackReactionInput> = {}): AttackReactionInput {
  return {
    className: "fighter",
    level: 5,
    abilityScores: { strength: 14, dexterity: 12, constitution: 14, intelligence: 10, wisdom: 10, charisma: 10 },
    resources: {
      hasProtectionStyle: true,
      hasShieldEquipped: true,
      hasInterceptionStyle: false,
      hasWeaponEquipped: false,
    },
    hasReaction: true,
    isCharacter: true,
    attackRoll: 18,
    attackerId: "attacker-1",
    targetAC: 15,
    activeConditions: [],
    ...overrides,
  };
}

describe("detectAllyAttackReactions (Fighter Protection/Interception)", () => {
  it("returns Protection when fighter has the style + shield + reaction", () => {
    const result = detectAllyAttackReactions(baseInput(), [FIGHTER_COMBAT_TEXT_PROFILE]);
    const protection = result.find((r) => r.reactionType === "protection");
    expect(protection).toBeDefined();
    expect(protection?.context.effect).toBe("disadvantage");
    expect(protection?.context.attackerId).toBe("attacker-1");
  });

  it("returns null when Fighter does not have Protection style", () => {
    const result = detectAllyAttackReactions(
      baseInput({ resources: { hasProtectionStyle: false, hasShieldEquipped: true } }),
      [FIGHTER_COMBAT_TEXT_PROFILE],
    );
    expect(result.find((r) => r.reactionType === "protection")).toBeUndefined();
  });

  it("returns null when Fighter has Protection style but no shield equipped", () => {
    const result = detectAllyAttackReactions(
      baseInput({ resources: { hasProtectionStyle: true, hasShieldEquipped: false } }),
      [FIGHTER_COMBAT_TEXT_PROFILE],
    );
    expect(result.find((r) => r.reactionType === "protection")).toBeUndefined();
  });

  it("returns null when protector has no reaction available", () => {
    const result = detectAllyAttackReactions(
      baseInput({ hasReaction: false }),
      [FIGHTER_COMBAT_TEXT_PROFILE],
    );
    expect(result.find((r) => r.reactionType === "protection")).toBeUndefined();
  });

  it("returns null when protector is Incapacitated", () => {
    const result = detectAllyAttackReactions(
      baseInput({ activeConditions: ["incapacitated"] }),
      [FIGHTER_COMBAT_TEXT_PROFILE],
    );
    expect(result.find((r) => r.reactionType === "protection")).toBeUndefined();
  });

  it("returns null when protector is Stunned / Unconscious / Paralyzed / Petrified", () => {
    for (const cond of ["stunned", "unconscious", "paralyzed", "petrified"]) {
      const result = detectAllyAttackReactions(
        baseInput({ activeConditions: [cond] }),
        [FIGHTER_COMBAT_TEXT_PROFILE],
      );
      expect(result.find((r) => r.reactionType === "protection")).toBeUndefined();
    }
  });

  it("returns Interception when fighter has the style + shield or weapon", () => {
    const withShield = detectAllyAttackReactions(
      baseInput({
        resources: {
          hasProtectionStyle: false,
          hasInterceptionStyle: true,
          hasShieldEquipped: true,
          hasWeaponEquipped: false,
        },
      }),
      [FIGHTER_COMBAT_TEXT_PROFILE],
    );
    const icep = withShield.find((r) => r.reactionType === "interception");
    expect(icep).toBeDefined();
    expect(icep?.context.profBonus).toBe(3); // level 5 PB = +3
    expect(icep?.context.damageReduction).toBe("1d10+3");

    const withWeapon = detectAllyAttackReactions(
      baseInput({
        resources: {
          hasProtectionStyle: false,
          hasInterceptionStyle: true,
          hasShieldEquipped: false,
          hasWeaponEquipped: true,
        },
      }),
      [FIGHTER_COMBAT_TEXT_PROFILE],
    );
    expect(withWeapon.find((r) => r.reactionType === "interception")).toBeDefined();
  });

  it("returns null for Interception when neither shield nor weapon is equipped", () => {
    const result = detectAllyAttackReactions(
      baseInput({
        resources: {
          hasProtectionStyle: false,
          hasInterceptionStyle: true,
          hasShieldEquipped: false,
          hasWeaponEquipped: false,
        },
      }),
      [FIGHTER_COMBAT_TEXT_PROFILE],
    );
    expect(result.find((r) => r.reactionType === "interception")).toBeUndefined();
  });
});

describe("detectAttackReactions (target-scan) does NOT return Protection/Interception", () => {
  it("target-scan never returns Fighter ally-scan reactions (prevents double-fire)", () => {
    // Even if a Fighter happens to be the target with all flags set, the target-scan
    // must not expose Protection/Interception — they are ally-scan reactions only.
    const input = baseInput();
    const result = detectAttackReactions(input, [FIGHTER_COMBAT_TEXT_PROFILE]);
    expect(result.find((r) => r.reactionType === "protection")).toBeUndefined();
    expect(result.find((r) => r.reactionType === "interception")).toBeUndefined();
  });
});
