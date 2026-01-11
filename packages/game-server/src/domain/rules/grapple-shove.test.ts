import { describe, expect, it } from "vitest";
import { FixedDiceRoller } from "./dice-roller.js";
import {
  isTargetTooLarge,
  resolveGrapple,
  resolveShove,
  type GrappleAttempt,
  type ShoveAttempt,
} from "./grapple-shove.js";

describe("Grapple and Shove", () => {
  describe("resolveGrapple", () => {
    it("should succeed when attacker roll beats target", () => {
      const dice = new FixedDiceRoller(15);
      const attempt: GrappleAttempt = {
        attackerAthleticsModifier: 3,
        targetContestModifier: 1,
        targetTooLarge: false,
        hasFreeHand: true,
      };

      const result = resolveGrapple(dice, attempt);

      expect(result.success).toBe(true);
      expect(result.attackerRoll).toBe(18); // 15 + 3
      expect(result.targetRoll).toBe(16); // 15 + 1
    });

    it("should fail when target roll beats attacker", () => {
      const dice = new FixedDiceRoller(10);
      const attempt: GrappleAttempt = {
        attackerAthleticsModifier: 1,
        targetContestModifier: 5,
        targetTooLarge: false,
        hasFreeHand: true,
      };

      const result = resolveGrapple(dice, attempt);

      expect(result.success).toBe(false);
      expect(result.attackerRoll).toBe(11); // 10 + 1
      expect(result.targetRoll).toBe(15); // 10 + 5
    });

    it("should succeed on ties (attacker wins)", () => {
      const dice = new FixedDiceRoller(10);
      const attempt: GrappleAttempt = {
        attackerAthleticsModifier: 2,
        targetContestModifier: 2,
        targetTooLarge: false,
        hasFreeHand: true,
      };

      const result = resolveGrapple(dice, attempt);

      expect(result.success).toBe(true);
      expect(result.attackerRoll).toBe(12);
      expect(result.targetRoll).toBe(12);
    });

    it("should fail if target is too large", () => {
      const dice = new FixedDiceRoller(20);
      const attempt: GrappleAttempt = {
        attackerAthleticsModifier: 10,
        targetContestModifier: 0,
        targetTooLarge: true,
        hasFreeHand: true,
      };

      const result = resolveGrapple(dice, attempt);

      expect(result.success).toBe(false);
      expect(result.reason).toBe("Target is too large to grapple");
    });

    it("should fail if no free hand", () => {
      const dice = new FixedDiceRoller(20);
      const attempt: GrappleAttempt = {
        attackerAthleticsModifier: 10,
        targetContestModifier: 0,
        targetTooLarge: false,
        hasFreeHand: false,
      };

      const result = resolveGrapple(dice, attempt);

      expect(result.success).toBe(false);
      expect(result.reason).toBe("You need at least one free hand to grapple");
    });
  });

  describe("resolveShove", () => {
    it("should succeed when attacker roll beats target (push)", () => {
      const dice = new FixedDiceRoller(15);
      const attempt: ShoveAttempt = {
        attackerAthleticsModifier: 4,
        targetContestModifier: 2,
        targetTooLarge: false,
        shoveType: "push",
      };

      const result = resolveShove(dice, attempt);

      expect(result.success).toBe(true);
      expect(result.shoveType).toBe("push");
      expect(result.attackerRoll).toBe(19); // 15 + 4
      expect(result.targetRoll).toBe(17); // 15 + 2
    });

    it("should succeed when attacker roll beats target (prone)", () => {
      const dice = new FixedDiceRoller(12);
      const attempt: ShoveAttempt = {
        attackerAthleticsModifier: 3,
        targetContestModifier: 1,
        targetTooLarge: false,
        shoveType: "prone",
      };

      const result = resolveShove(dice, attempt);

      expect(result.success).toBe(true);
      expect(result.shoveType).toBe("prone");
    });

    it("should fail if target is too large", () => {
      const dice = new FixedDiceRoller(20);
      const attempt: ShoveAttempt = {
        attackerAthleticsModifier: 10,
        targetContestModifier: 0,
        targetTooLarge: true,
        shoveType: "push",
      };

      const result = resolveShove(dice, attempt);

      expect(result.success).toBe(false);
      expect(result.reason).toBe("Target is too large to shove");
    });
  });

  describe("isTargetTooLarge", () => {
    it("should allow grappling same size", () => {
      expect(isTargetTooLarge("Medium", "Medium")).toBe(false);
    });

    it("should allow grappling one size larger", () => {
      expect(isTargetTooLarge("Medium", "Large")).toBe(false);
      expect(isTargetTooLarge("Small", "Medium")).toBe(false);
    });

    it("should prevent grappling two sizes larger", () => {
      expect(isTargetTooLarge("Medium", "Huge")).toBe(true);
      expect(isTargetTooLarge("Small", "Large")).toBe(true);
      expect(isTargetTooLarge("Tiny", "Medium")).toBe(true);
    });

    it("should allow grappling smaller creatures", () => {
      expect(isTargetTooLarge("Large", "Medium")).toBe(false);
      expect(isTargetTooLarge("Medium", "Small")).toBe(false);
      expect(isTargetTooLarge("Large", "Tiny")).toBe(false);
    });
  });
});
