import { describe, expect, it } from "vitest";
import { FixedDiceRoller } from "./dice-roller.js";
import {
  isTargetTooLarge,
  grappleTarget,
  shoveTarget,
  escapeGrapple,
} from "./grapple-shove.js";

describe("Grapple and Shove (2024 rules)", () => {
  describe("grappleTarget", () => {
    it("should succeed when Unarmed Strike hits and target fails save", () => {
      // Attacker: STR mod +3, prof +2 → attack bonus +5
      // Target AC 12 — d20(15) + 5 = 20 → hits
      // DC = 8 + 3 + 2 = 13
      // Target: STR mod +1, DEX mod +0 → uses STR, rolls d20(8) + 1 = 9 → fails vs DC 13
      const dice = new FixedDiceRoller([15, 8]);
      const result = grappleTarget(3, 2, 12, 1, 0, false, true, dice);

      expect(result.success).toBe(true);
      expect(result.hit).toBe(true);
      expect(result.attackRoll).toBe(15);
      expect(result.attackTotal).toBe(20); // 15 + 3 + 2
      expect(result.targetAC).toBe(12);
      expect(result.dc).toBe(13); // 8 + 3 + 2
      expect(result.saveRoll).toBe(8);
      expect(result.total).toBe(9); // 8 + 1 (uses STR since STR > DEX)
      expect(result.abilityUsed).toBe("strength");
    });

    it("should fail when Unarmed Strike misses", () => {
      // Attacker: STR mod +1, prof +2 → attack bonus +3
      // Target AC 18 — d20(10) + 3 = 13 → misses
      const dice = new FixedDiceRoller(10);
      const result = grappleTarget(1, 2, 18, 0, 5, false, true, dice);

      expect(result.success).toBe(false);
      expect(result.hit).toBe(false);
      expect(result.attackTotal).toBe(13);
      expect(result.targetAC).toBe(18);
      expect(result.reason).toBe("Unarmed Strike missed");
    });

    it("should fail when attack hits but target beats save DC", () => {
      // Attacker: STR mod +2, prof +2 → attack bonus +4, DC = 8 + 2 + 2 = 12
      // Target AC 10 — d20(15) + 4 = 19 → hits
      // Target: STR mod +4, DEX mod +0 → uses STR, rolls d20(10) + 4 = 14 → beats DC 12
      const dice = new FixedDiceRoller([15, 10]);
      const result = grappleTarget(2, 2, 10, 4, 0, false, true, dice);

      expect(result.success).toBe(false);
      expect(result.hit).toBe(true);
      expect(result.dc).toBe(12);
      expect(result.total).toBe(14);
    });

    it("should fail when target ties the save (meets DC to resist)", () => {
      // Attacker: STR mod +2, prof +2 → DC = 12
      // Target: STR mod +2 → rolls d20(10) + 2 = 12 → meets DC → resists
      const dice = new FixedDiceRoller([18, 10]);
      const result = grappleTarget(2, 2, 10, 2, 0, false, true, dice);

      expect(result.success).toBe(false); // target meets DC → save succeeds → grapple fails
      expect(result.hit).toBe(true);
      expect(result.dc).toBe(12);
      expect(result.total).toBe(12);
    });

    it("target uses DEX save when DEX > STR", () => {
      // Target: STR 0, DEX +5 → picks DEX
      const dice = new FixedDiceRoller([18, 2]); // attack hits, save roll low
      const result = grappleTarget(3, 2, 10, 0, 5, false, true, dice);

      expect(result.success).toBe(true);
      expect(result.abilityUsed).toBe("dexterity");
    });

    it("should fail if target is too large", () => {
      const dice = new FixedDiceRoller(20);
      const result = grappleTarget(10, 2, 10, 0, 0, true, true, dice);

      expect(result.success).toBe(false);
      expect(result.hit).toBe(false);
      expect(result.reason).toBe("Target is too large to grapple");
    });

    it("should fail if no free hand", () => {
      const dice = new FixedDiceRoller(20);
      const result = grappleTarget(10, 2, 10, 0, 0, false, false, dice);

      expect(result.success).toBe(false);
      expect(result.hit).toBe(false);
      expect(result.reason).toBe("You need at least one free hand to grapple");
    });
  });

  describe("shoveTarget", () => {
    it("should succeed when Unarmed Strike hits and target fails save", () => {
      // Attacker: STR mod +4, prof +2 → attack bonus +6, DC = 8 + 4 + 2 = 14
      // Target AC 12 — d20(15) + 6 = 21 → hits
      // Target: STR mod +2, DEX mod +0 → uses STR, rolls d20(8) + 2 = 10 → fails vs DC 14
      const dice = new FixedDiceRoller([15, 8]);
      const result = shoveTarget(4, 2, 12, 2, 0, false, dice);

      expect(result.success).toBe(true);
      expect(result.hit).toBe(true);
      expect(result.attackTotal).toBe(21);
      expect(result.dc).toBe(14); // 8 + 4 + 2
      expect(result.total).toBe(10); // 8 + 2
      expect(result.abilityUsed).toBe("strength");
    });

    it("should fail when Unarmed Strike misses", () => {
      // Attacker: STR mod +3, prof +2 → attack bonus +5
      // Target AC 18 — d20(12) + 5 = 17 → misses
      const dice = new FixedDiceRoller(12);
      const result = shoveTarget(3, 2, 18, 1, 3, false, dice);

      expect(result.success).toBe(false);
      expect(result.hit).toBe(false);
      expect(result.reason).toBe("Unarmed Strike missed");
    });

    it("should succeed with target using DEX when DEX > STR", () => {
      const dice = new FixedDiceRoller([18, 2]); // attack hits, save roll low
      const result = shoveTarget(3, 2, 10, 1, 3, false, dice);

      expect(result.success).toBe(true);
      expect(result.abilityUsed).toBe("dexterity");
    });

    it("should fail if target is too large", () => {
      const dice = new FixedDiceRoller(20);
      const result = shoveTarget(10, 2, 10, 0, 0, true, dice);

      expect(result.success).toBe(false);
      expect(result.reason).toBe("Target is too large to shove");
    });
  });

  describe("escapeGrapple", () => {
    it("should succeed when escapee beats the static DC", () => {
      // Grappler: STR mod +3, prof +2 → DC = 8 + 3 + 2 = 13
      // Escapee: STR mod +1, DEX mod +4 → uses DEX, rolls d20(15) + 4 = 19 → beats DC 13
      const dice = new FixedDiceRoller(15);
      const result = escapeGrapple(3, 2, 1, 4, dice);

      expect(result.success).toBe(true);
      expect(result.dc).toBe(13);
      expect(result.total).toBe(19);
      expect(result.abilityUsed).toBe("dexterity");
    });

    it("should fail when escapee doesn't beat the DC", () => {
      // Grappler: STR mod +5, prof +3 → DC = 8 + 5 + 3 = 16
      // Escapee: STR mod +2, DEX mod +1 → uses STR, rolls d20(10) + 2 = 12 → fails
      const dice = new FixedDiceRoller(10);
      const result = escapeGrapple(5, 3, 2, 1, dice);

      expect(result.success).toBe(false);
      expect(result.dc).toBe(16);
      expect(result.total).toBe(12);
      expect(result.abilityUsed).toBe("strength");
    });

    it("should add Athletics proficiency bonus when proficient", () => {
      // Grappler: STR mod +3, prof +2 → DC = 8 + 3 + 2 = 13
      // Escapee: STR mod +1, DEX mod +2, proficient in Athletics (prof +2)
      // Athletics total modifier = 1 + 2 = 3, Acrobatics total modifier = 2 + 0 = 2
      // Picks Athletics (3 > 2), rolls d20(10) + 3 = 13 → meets DC 13 → success
      const dice = new FixedDiceRoller(10);
      const result = escapeGrapple(3, 2, 1, 2, dice, { athleticsBonus: 2, acrobaticsBonus: 0 });

      expect(result.success).toBe(true);
      expect(result.dc).toBe(13);
      expect(result.total).toBe(13);
      expect(result.abilityUsed).toBe("strength");
    });

    it("should prefer Acrobatics when proficiency makes it higher", () => {
      // Grappler: STR mod +2, prof +2 → DC = 8 + 2 + 2 = 12
      // Escapee: STR mod +3, DEX mod +1, proficient in Acrobatics (prof +3)
      // Athletics total = 3 + 0 = 3, Acrobatics total = 1 + 3 = 4
      // Picks Acrobatics (4 > 3), rolls d20(10) + 4 = 14 → beats DC 12
      const dice = new FixedDiceRoller(10);
      const result = escapeGrapple(2, 2, 3, 1, dice, { athleticsBonus: 0, acrobaticsBonus: 3 });

      expect(result.success).toBe(true);
      expect(result.dc).toBe(12);
      expect(result.total).toBe(14);
      expect(result.abilityUsed).toBe("dexterity");
    });

    it("should work without proficiency info (backward compatible)", () => {
      // Same as first test — no proficiency arg
      const dice = new FixedDiceRoller(15);
      const result = escapeGrapple(3, 2, 1, 4, dice);

      expect(result.success).toBe(true);
      expect(result.dc).toBe(13);
      expect(result.total).toBe(19);
      expect(result.abilityUsed).toBe("dexterity");
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
