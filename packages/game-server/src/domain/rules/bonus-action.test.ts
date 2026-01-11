import { describe, expect, it } from "vitest";
import {
  canMakeOffHandAttack,
  canUseBonusAction,
  createBonusActionState,
  hasBonusActionAvailable,
  resetBonusAction,
  useBonusAction,
  type BonusActionState,
  type TwoWeaponFightingCheck,
} from "./bonus-action.js";

describe("Bonus Actions", () => {
  describe("bonus action state", () => {
    it("should create bonus action state with action available", () => {
      const state = createBonusActionState();
      expect(hasBonusActionAvailable(state)).toBe(true);
    });

    it("should mark bonus action as used", () => {
      const state = createBonusActionState();
      const used = useBonusAction(state);
      expect(hasBonusActionAvailable(used)).toBe(false);
    });

    it("should reset bonus action", () => {
      const used: BonusActionState = { bonusActionUsed: true };
      const reset = resetBonusAction();
      expect(hasBonusActionAvailable(reset)).toBe(true);
    });
  });

  describe("canUseBonusAction", () => {
    it("should allow bonus action when available and has feature", () => {
      const state = createBonusActionState();
      const result = canUseBonusAction(state, "CunningAction", true);

      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("should prevent bonus action if already used", () => {
      const state: BonusActionState = { bonusActionUsed: true };
      const result = canUseBonusAction(state, "CunningAction", true);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("Bonus action already used this turn");
    });

    it("should prevent bonus action if missing required feature", () => {
      const state = createBonusActionState();
      const result = canUseBonusAction(state, "FlurryOfBlows", false);

      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("Missing required feature, spell, or ability");
    });

    it("should allow multiple bonus action types when available", () => {
      const state = createBonusActionState();

      expect(canUseBonusAction(state, "HealingWord", true).allowed).toBe(true);
      expect(canUseBonusAction(state, "MistyStep", true).allowed).toBe(true);
      expect(canUseBonusAction(state, "SecondWind", true).allowed).toBe(true);
    });
  });

  describe("two-weapon fighting", () => {
    it("should allow off-hand attack when both weapons are light", () => {
      const check: TwoWeaponFightingCheck = {
        mainHandWeaponIsLight: true,
        offHandWeaponIsLight: true,
        addAbilityModifierToDamage: false,
      };

      const result = canMakeOffHandAttack(check);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("should prevent off-hand attack if main-hand weapon is not light", () => {
      const check: TwoWeaponFightingCheck = {
        mainHandWeaponIsLight: false,
        offHandWeaponIsLight: true,
        addAbilityModifierToDamage: false,
      };

      const result = canMakeOffHandAttack(check);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("Main-hand weapon must be light");
    });

    it("should prevent off-hand attack if off-hand weapon is not light", () => {
      const check: TwoWeaponFightingCheck = {
        mainHandWeaponIsLight: true,
        offHandWeaponIsLight: false,
        addAbilityModifierToDamage: false,
      };

      const result = canMakeOffHandAttack(check);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("Off-hand weapon must be light");
    });

    it("should track ability modifier damage bonus separately", () => {
      const checkWithoutBonus: TwoWeaponFightingCheck = {
        mainHandWeaponIsLight: true,
        offHandWeaponIsLight: true,
        addAbilityModifierToDamage: false,
      };

      const checkWithBonus: TwoWeaponFightingCheck = {
        mainHandWeaponIsLight: true,
        offHandWeaponIsLight: true,
        addAbilityModifierToDamage: true,
      };

      expect(canMakeOffHandAttack(checkWithoutBonus).allowed).toBe(true);
      expect(canMakeOffHandAttack(checkWithBonus).allowed).toBe(true);
      expect(checkWithBonus.addAbilityModifierToDamage).toBe(true);
    });
  });

  describe("bonus action economy", () => {
    it("should enforce one bonus action per turn", () => {
      const state = createBonusActionState();

      // Use bonus action
      const afterFirst = useBonusAction(state);
      expect(hasBonusActionAvailable(afterFirst)).toBe(false);

      // Try to use again - should fail
      const result = canUseBonusAction(afterFirst, "CunningAction", true);
      expect(result.allowed).toBe(false);
    });

    it("should refresh bonus action on turn reset", () => {
      const used: BonusActionState = { bonusActionUsed: true };
      expect(hasBonusActionAvailable(used)).toBe(false);

      const reset = resetBonusAction();
      expect(hasBonusActionAvailable(reset)).toBe(true);

      const result = canUseBonusAction(reset, "HealingWord", true);
      expect(result.allowed).toBe(true);
    });
  });
});
