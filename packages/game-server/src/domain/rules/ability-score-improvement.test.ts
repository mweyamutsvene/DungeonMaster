import { describe, expect, it } from "vitest";

import {
  getASILevels,
  validateASIChoice,
  applyASIChoices,
  collectASIFeatIds,
  type ASIChoice,
} from "./ability-score-improvement.js";

describe("Ability Score Improvement", () => {
  describe("getASILevels", () => {
    it("returns standard ASI levels for most classes", () => {
      expect(getASILevels("wizard")).toEqual([4, 8, 12, 16, 19]);
      expect(getASILevels("cleric")).toEqual([4, 8, 12, 16, 19]);
      expect(getASILevels("barbarian")).toEqual([4, 8, 12, 16, 19]);
    });

    it("returns fighter ASI levels with extras at 6 and 14", () => {
      expect(getASILevels("fighter")).toEqual([4, 6, 8, 12, 14, 16, 19]);
    });

    it("returns rogue ASI levels with extra at 10", () => {
      expect(getASILevels("rogue")).toEqual([4, 8, 10, 12, 16, 19]);
    });

    it("is case insensitive", () => {
      expect(getASILevels("Fighter")).toEqual([4, 6, 8, 12, 14, 16, 19]);
    });
  });

  describe("validateASIChoice", () => {
    const baseScores = { strength: 16, dexterity: 14, constitution: 12, intelligence: 10, wisdom: 10, charisma: 8 };

    it("accepts valid +2 to one ability", () => {
      const choice: ASIChoice = { level: 4, type: "asi", scores: { strength: 2 } };
      expect(validateASIChoice(choice, "fighter", baseScores)).toBeNull();
    });

    it("accepts valid +1/+1 to two abilities", () => {
      const choice: ASIChoice = { level: 4, type: "asi", scores: { strength: 1, dexterity: 1 } };
      expect(validateASIChoice(choice, "fighter", baseScores)).toBeNull();
    });

    it("rejects invalid ASI level", () => {
      const choice: ASIChoice = { level: 3, type: "asi", scores: { strength: 2 } };
      const err = validateASIChoice(choice, "fighter", baseScores);
      expect(err).toContain("not an ASI level");
    });

    it("rejects total increase != 2", () => {
      const choice: ASIChoice = { level: 4, type: "asi", scores: { strength: 1 } };
      const err = validateASIChoice(choice, "fighter", baseScores);
      expect(err).toContain("exactly 2");
    });

    it("rejects score exceeding 20", () => {
      const scores = { ...baseScores, strength: 19 };
      const choice: ASIChoice = { level: 4, type: "asi", scores: { strength: 2 } };
      const err = validateASIChoice(choice, "fighter", scores);
      expect(err).toContain("exceed 20");
    });

    it("accepts fighter ASI at level 6", () => {
      const choice: ASIChoice = { level: 6, type: "asi", scores: { dexterity: 2 } };
      expect(validateASIChoice(choice, "fighter", baseScores)).toBeNull();
    });

    it("rejects non-fighter at level 6", () => {
      const choice: ASIChoice = { level: 6, type: "asi", scores: { dexterity: 2 } };
      const err = validateASIChoice(choice, "wizard", baseScores);
      expect(err).toContain("not an ASI level");
    });

    it("accepts feat selection", () => {
      const choice: ASIChoice = { level: 4, type: "feat", featId: "feat_alert" };
      expect(validateASIChoice(choice, "wizard", baseScores)).toBeNull();
    });

    it("rejects feat without featId", () => {
      const choice: ASIChoice = { level: 4, type: "feat" };
      const err = validateASIChoice(choice, "wizard", baseScores);
      expect(err).toContain("non-empty 'featId'");
    });

    it("rejects invalid ability name", () => {
      const choice: ASIChoice = { level: 4, type: "asi", scores: { luck: 2 } };
      const err = validateASIChoice(choice, "fighter", baseScores);
      expect(err).toContain("Invalid ability: luck");
    });
  });

  describe("applyASIChoices", () => {
    it("applies +2 to one ability", () => {
      const base = { strength: 16, dexterity: 14 };
      const choices: ASIChoice[] = [{ level: 4, type: "asi", scores: { strength: 2 } }];
      const result = applyASIChoices(base, choices, 5);
      expect(result.strength).toBe(18);
      expect(result.dexterity).toBe(14);
    });

    it("applies multiple ASI choices", () => {
      const base = { strength: 14, dexterity: 14 };
      const choices: ASIChoice[] = [
        { level: 4, type: "asi", scores: { strength: 2 } },
        { level: 8, type: "asi", scores: { dexterity: 1, strength: 1 } },
      ];
      const result = applyASIChoices(base, choices, 10);
      expect(result.strength).toBe(17);
      expect(result.dexterity).toBe(15);
    });

    it("caps at 20", () => {
      const base = { strength: 19 };
      const choices: ASIChoice[] = [{ level: 4, type: "asi", scores: { strength: 2 } }];
      const result = applyASIChoices(base, choices, 5);
      expect(result.strength).toBe(20);
    });

    it("ignores choices above character level", () => {
      const base = { strength: 14 };
      const choices: ASIChoice[] = [{ level: 8, type: "asi", scores: { strength: 2 } }];
      const result = applyASIChoices(base, choices, 5);
      expect(result.strength).toBe(14);
    });

    it("ignores feat-type choices (no score change)", () => {
      const base = { strength: 14 };
      const choices: ASIChoice[] = [{ level: 4, type: "feat", featId: "feat_alert" }];
      const result = applyASIChoices(base, choices, 5);
      expect(result.strength).toBe(14);
    });
  });

  describe("collectASIFeatIds", () => {
    it("collects feat IDs from feat choices", () => {
      const choices: ASIChoice[] = [
        { level: 4, type: "feat", featId: "feat_alert" },
        { level: 8, type: "asi", scores: { strength: 2 } },
        { level: 12, type: "feat", featId: "feat_sharpshooter" },
      ];
      expect(collectASIFeatIds(choices, 15)).toEqual(["feat_alert", "feat_sharpshooter"]);
    });

    it("respects character level", () => {
      const choices: ASIChoice[] = [
        { level: 4, type: "feat", featId: "feat_alert" },
        { level: 12, type: "feat", featId: "feat_sharpshooter" },
      ];
      expect(collectASIFeatIds(choices, 5)).toEqual(["feat_alert"]);
    });
  });
});
