import { describe, expect, it } from "vitest";
import { FixedDiceRoller } from "./dice-roller.js";
import {
  attemptHide,
  detectHidden,
  searchForHidden,
  type HideAttempt,
} from "./hide.js";

describe("Hide Action", () => {
  describe("attemptHide", () => {
    it("should succeed with cover and make stealth roll", () => {
      const dice = new FixedDiceRoller(15);
      const attempt: HideAttempt = {
        stealthModifier: 5,
        hasCoverOrObscurement: true,
        clearlyVisible: false,
      };

      const result = attemptHide(dice, attempt);

      expect(result.success).toBe(true);
      expect(result.stealthRoll).toBe(20); // 15 + 5
      expect(result.reason).toBeUndefined();
    });

    it("should fail if clearly visible", () => {
      const dice = new FixedDiceRoller(20);
      const attempt: HideAttempt = {
        stealthModifier: 10,
        hasCoverOrObscurement: true,
        clearlyVisible: true,
      };

      const result = attemptHide(dice, attempt);

      expect(result.success).toBe(false);
      expect(result.reason).toBe("You can't hide from someone who can see you clearly");
    });

    it("should fail if no cover or obscurement", () => {
      const dice = new FixedDiceRoller(20);
      const attempt: HideAttempt = {
        stealthModifier: 10,
        hasCoverOrObscurement: false,
        clearlyVisible: false,
      };

      const result = attemptHide(dice, attempt);

      expect(result.success).toBe(false);
      expect(result.reason).toBe("You need cover or obscurement to hide");
    });

    it("should fail if passive perception detects the stealth roll", () => {
      const dice = new FixedDiceRoller(9);
      const attempt: HideAttempt = {
        stealthModifier: 3,
        hasCoverOrObscurement: true,
        clearlyVisible: false,
        observerPassivePerception: 12,
      };

      const result = attemptHide(dice, attempt);

      expect(result.success).toBe(false);
      expect(result.stealthRoll).toBe(12);
      expect(result.reason).toBe("An observer notices you");
    });
  });

  describe("detectHidden", () => {
    it("should detect if passive perception beats stealth", () => {
      const detected = detectHidden(15, 16);
      expect(detected).toBe(true);
    });

    it("should not detect if stealth beats passive perception", () => {
      const detected = detectHidden(20, 16);
      expect(detected).toBe(false);
    });

    it("should detect on ties (perception wins)", () => {
      const detected = detectHidden(15, 15);
      expect(detected).toBe(true);
    });
  });

  describe("searchForHidden", () => {
    it("should detect with successful active Perception check", () => {
      const dice = new FixedDiceRoller(12);
      const result = searchForHidden(dice, 15, 4);

      expect(result.detected).toBe(true);
      expect(result.perceptionRoll).toBe(16); // 12 + 4
    });

    it("should not detect with failed Perception check", () => {
      const dice = new FixedDiceRoller(10);
      const result = searchForHidden(dice, 20, 2);

      expect(result.detected).toBe(false);
      expect(result.perceptionRoll).toBe(12); // 10 + 2
    });

    it("should detect on ties (perception wins)", () => {
      const dice = new FixedDiceRoller(10);
      const result = searchForHidden(dice, 15, 5);

      expect(result.detected).toBe(true);
      expect(result.perceptionRoll).toBe(15); // 10 + 5
    });
  });

});
