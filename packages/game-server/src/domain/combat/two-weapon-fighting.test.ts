import { describe, it, expect } from "vitest";
import {
  canMakeOffhandAttack,
  computeOffhandDamageModifier,
  evaluateOffhandAttackEligibility,
} from "./two-weapon-fighting.js";

describe("Two-Weapon Fighting", () => {
  describe("evaluateOffhandAttackEligibility", () => {
    const lightMain = { properties: ["Light", "Finesse"] };
    const lightOff = { properties: ["Light"] };

    it("allows light + light when Attack action was taken", () => {
      const result = evaluateOffhandAttackEligibility({
        mainWeapon: lightMain,
        offhandWeapon: lightOff,
        hasTakenAttackActionThisTurn: true,
      });

      expect(result).toMatchObject({
        allowed: true,
        reason: "OK",
        requiresBonusAction: true,
        usesNick: false,
      });
    });

    it("rejects when Attack action was not taken this turn", () => {
      const result = evaluateOffhandAttackEligibility({
        mainWeapon: lightMain,
        offhandWeapon: lightOff,
        hasTakenAttackActionThisTurn: false,
      });

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("ATTACK_ACTION_REQUIRED");
    });

    it("allows non-Light pair with Dual Wielder", () => {
      const result = evaluateOffhandAttackEligibility({
        mainWeapon: { properties: ["Versatile"] },
        offhandWeapon: { properties: ["Heavy"] },
        hasDualWielderFeat: true,
        hasTakenAttackActionThisTurn: true,
      });

      expect(result.allowed).toBe(true);
      expect(result.reason).toBe("OK");
    });

    it("Nick waives bonus action once per turn", () => {
      const firstNick = evaluateOffhandAttackEligibility({
        mainWeapon: lightMain,
        offhandWeapon: lightOff,
        hasTakenAttackActionThisTurn: true,
        hasNickMastery: true,
        nickUsedThisTurn: false,
      });
      expect(firstNick.allowed).toBe(true);
      expect(firstNick.usesNick).toBe(true);
      expect(firstNick.requiresBonusAction).toBe(false);

      const secondNick = evaluateOffhandAttackEligibility({
        mainWeapon: lightMain,
        offhandWeapon: lightOff,
        hasTakenAttackActionThisTurn: true,
        hasNickMastery: true,
        nickUsedThisTurn: true,
      });
      expect(secondNick.allowed).toBe(true);
      expect(secondNick.usesNick).toBe(false);
      expect(secondNick.requiresBonusAction).toBe(true);
    });

    it("reports style damage policy in eligibility result", () => {
      const withStyle = evaluateOffhandAttackEligibility({
        mainWeapon: lightMain,
        offhandWeapon: lightOff,
        hasTakenAttackActionThisTurn: true,
        hasTwoWeaponFightingStyle: true,
      });
      expect(withStyle.offhandAddsAbilityModifier).toBe(true);

      const withoutStyle = evaluateOffhandAttackEligibility({
        mainWeapon: lightMain,
        offhandWeapon: lightOff,
        hasTakenAttackActionThisTurn: true,
        hasTwoWeaponFightingStyle: false,
      });
      expect(withoutStyle.offhandAddsAbilityModifier).toBe(false);
    });
  });

  describe("canMakeOffhandAttack", () => {
    it("allows when both weapons have Light property", () => {
      const main = { properties: ["Light", "Finesse"] };
      const off = { properties: ["Light"] };
      expect(canMakeOffhandAttack(main, off)).toBe(true);
    });

    it("rejects when main weapon is not Light", () => {
      const main = { properties: ["Versatile"] };
      const off = { properties: ["Light"] };
      expect(canMakeOffhandAttack(main, off)).toBe(false);
    });

    it("rejects when offhand weapon is not Light", () => {
      const main = { properties: ["Light"] };
      const off = { properties: ["Heavy", "Two-Handed"] };
      expect(canMakeOffhandAttack(main, off)).toBe(false);
    });

    it("rejects when either weapon is null", () => {
      expect(canMakeOffhandAttack(null, { properties: ["Light"] })).toBe(false);
      expect(canMakeOffhandAttack({ properties: ["Light"] }, null)).toBe(false);
    });

    it("rejects when weapons have no properties", () => {
      expect(canMakeOffhandAttack({}, {})).toBe(false);
      expect(canMakeOffhandAttack({ properties: [] }, { properties: [] })).toBe(false);
    });

    it("allows any weapons with Dual Wielder feat", () => {
      const main = { properties: ["Versatile"] };
      const off = { properties: ["Heavy"] };
      expect(canMakeOffhandAttack(main, off, true)).toBe(true);
    });

    it("case-insensitive Light check", () => {
      const main = { properties: ["light"] };
      const off = { properties: ["LIGHT"] };
      expect(canMakeOffhandAttack(main, off)).toBe(true);
    });
  });

  describe("computeOffhandDamageModifier", () => {
    it("suppresses only positive modifiers without Two-Weapon Fighting style", () => {
      expect(computeOffhandDamageModifier(3, false)).toBe(0);
      expect(computeOffhandDamageModifier(5, false)).toBe(0);
      expect(computeOffhandDamageModifier(0, false)).toBe(0);
      expect(computeOffhandDamageModifier(-1, false)).toBe(-1);
    });

    it("returns ability modifier with Two-Weapon Fighting style", () => {
      expect(computeOffhandDamageModifier(3, true)).toBe(3);
      expect(computeOffhandDamageModifier(-1, true)).toBe(-1);
    });
  });
});
