import { describe, expect, it } from "vitest";
import {
  canMakeOpportunityAttack,
  createReactionState,
  hasReactionAvailable,
  isLeavingReach,
  isWithinReach,
  resetReaction,
  useReaction,
  type OpportunityAttackTrigger,
  type ReactionState,
} from "./opportunity-attack.js";

describe("Opportunity Attacks", () => {
  describe("canMakeOpportunityAttack", () => {
    const baseTrigger: OpportunityAttackTrigger = {
      movingCreatureId: "target",
      observerId: "attacker",
      disengaged: false,
      canSee: true,
      observerIncapacitated: false,
      leavingReach: true,
    };

    it("should allow attack when all conditions are met", () => {
      const reaction: ReactionState = { reactionUsed: false };
      const result = canMakeOpportunityAttack(reaction, baseTrigger);

      expect(result.canAttack).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("should prevent attack if reaction already used", () => {
      const reaction: ReactionState = { reactionUsed: true };
      const result = canMakeOpportunityAttack(reaction, baseTrigger);

      expect(result.canAttack).toBe(false);
      expect(result.reason).toBe("no-reaction");
    });

    it("should prevent attack if target disengaged", () => {
      const reaction: ReactionState = { reactionUsed: false };
      const trigger = { ...baseTrigger, disengaged: true };
      const result = canMakeOpportunityAttack(reaction, trigger);

      expect(result.canAttack).toBe(false);
      expect(result.reason).toBe("disengaged");
    });

    it("should prevent attack if cannot see target", () => {
      const reaction: ReactionState = { reactionUsed: false };
      const trigger = { ...baseTrigger, canSee: false };
      const result = canMakeOpportunityAttack(reaction, trigger);

      expect(result.canAttack).toBe(false);
      expect(result.reason).toBe("cannot-see");
    });

    it("should prevent attack if observer is incapacitated", () => {
      const reaction: ReactionState = { reactionUsed: false };
      const trigger = { ...baseTrigger, observerIncapacitated: true };
      const result = canMakeOpportunityAttack(reaction, trigger);

      expect(result.canAttack).toBe(false);
      expect(result.reason).toBe("incapacitated");
    });

    it("should prevent attack if not leaving reach", () => {
      const reaction: ReactionState = { reactionUsed: false };
      const trigger = { ...baseTrigger, leavingReach: false };
      const result = canMakeOpportunityAttack(reaction, trigger);

      expect(result.canAttack).toBe(false);
      expect(result.reason).toBe("not-leaving-reach");
    });
  });

  describe("reaction state", () => {
    it("should create reaction state with reaction available", () => {
      const state = createReactionState();
      expect(hasReactionAvailable(state)).toBe(true);
    });

    it("should mark reaction as used", () => {
      const state = createReactionState();
      const used = useReaction(state);
      expect(hasReactionAvailable(used)).toBe(false);
    });

    it("should reset reaction", () => {
      const used: ReactionState = { reactionUsed: true };
      const reset = resetReaction();
      expect(hasReactionAvailable(reset)).toBe(true);
    });
  });

  describe("reach calculations", () => {
    it("should determine if within reach", () => {
      expect(isWithinReach(5, 5)).toBe(true);
      expect(isWithinReach(4, 5)).toBe(true);
      expect(isWithinReach(6, 5)).toBe(false);
      expect(isWithinReach(0, 5)).toBe(true);
    });

    it("should determine if leaving reach", () => {
      // Starting within reach (5ft), ending outside (10ft)
      expect(isLeavingReach(5, 10, 5)).toBe(true);

      // Starting within reach, staying within reach
      expect(isLeavingReach(5, 5, 5)).toBe(false);
      expect(isLeavingReach(3, 4, 5)).toBe(false);

      // Starting outside reach, moving further
      expect(isLeavingReach(10, 15, 5)).toBe(false);

      // Starting outside reach, moving closer
      expect(isLeavingReach(10, 5, 5)).toBe(false);
    });

    it("should support custom reach values", () => {
      // 10ft reach weapon
      expect(isWithinReach(10, 10)).toBe(true);
      expect(isWithinReach(11, 10)).toBe(false);
      expect(isLeavingReach(10, 15, 10)).toBe(true);
    });
  });
});
