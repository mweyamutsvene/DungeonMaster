import { describe, expect, it } from "vitest";
import { FixedDiceRoller } from "./dice-roller.js";
import {
  attemptSearch,
  useObject,
  type SearchAttempt,
  type UseObjectAttempt,
} from "./search-use-object.js";

describe("Search and Use Object", () => {
  describe("attemptSearch", () => {
    it("should succeed on Perception check that meets DC", () => {
      const dice = new FixedDiceRoller(15);
      const attempt: SearchAttempt = {
        modifier: 3,
        dc: 15,
        checkType: "perception",
      };

      const result = attemptSearch(dice, attempt);

      expect(result.success).toBe(true);
      expect(result.roll).toBe(18); // 15 + 3
      expect(result.dc).toBe(15);
    });

    it("should fail on Perception check that misses DC", () => {
      const dice = new FixedDiceRoller(10);
      const attempt: SearchAttempt = {
        modifier: 2,
        dc: 20,
        checkType: "perception",
      };

      const result = attemptSearch(dice, attempt);

      expect(result.success).toBe(false);
      expect(result.roll).toBe(12); // 10 + 2
      expect(result.dc).toBe(20);
    });

    it("should succeed on Investigation check", () => {
      const dice = new FixedDiceRoller(12);
      const attempt: SearchAttempt = {
        modifier: 4,
        dc: 15,
        checkType: "investigation",
      };

      const result = attemptSearch(dice, attempt);

      expect(result.success).toBe(true);
      expect(result.roll).toBe(16); // 12 + 4
    });

    it("should succeed on ties", () => {
      const dice = new FixedDiceRoller(10);
      const attempt: SearchAttempt = {
        modifier: 5,
        dc: 15,
        checkType: "perception",
      };

      const result = attemptSearch(dice, attempt);

      expect(result.success).toBe(true);
      expect(result.roll).toBe(15);
    });
  });

  describe("useObject", () => {
    it("should automatically succeed for simple object uses", () => {
      const dice = new FixedDiceRoller(1);
      const attempt: UseObjectAttempt = {
        objectType: "drink-potion",
      };

      const result = useObject(dice, attempt);

      expect(result.success).toBe(true);
      expect(result.objectType).toBe("drink-potion");
      expect(result.roll).toBeUndefined();
    });

    it("should handle various object types without checks", () => {
      const dice = new FixedDiceRoller(1);

      expect(useObject(dice, { objectType: "open-door" }).success).toBe(true);
      expect(useObject(dice, { objectType: "pull-lever" }).success).toBe(true);
      expect(useObject(dice, { objectType: "light-torch" }).success).toBe(true);
      expect(useObject(dice, { objectType: "retrieve-item" }).success).toBe(true);
    });

    it("should require check when specified (success)", () => {
      const dice = new FixedDiceRoller(15);
      const attempt: UseObjectAttempt = {
        objectType: "open-door",
        requiresCheck: {
          dc: 15,
          modifier: 4,
          checkType: "strength",
        },
      };

      const result = useObject(dice, attempt);

      expect(result.success).toBe(true);
      expect(result.roll).toBe(19); // 15 + 4
      expect(result.dc).toBe(15);
    });

    it("should require check when specified (failure)", () => {
      const dice = new FixedDiceRoller(10);
      const attempt: UseObjectAttempt = {
        objectType: "open-door",
        requiresCheck: {
          dc: 20,
          modifier: 2,
          checkType: "strength",
        },
      };

      const result = useObject(dice, attempt);

      expect(result.success).toBe(false);
      expect(result.roll).toBe(12); // 10 + 2
      expect(result.dc).toBe(20);
    });
  });
});
