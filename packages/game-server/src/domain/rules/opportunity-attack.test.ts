import { describe, expect, it } from "vitest";
import {
  canMakeOpportunityAttack,
  canMakeSentinelReaction,
  createReactionState,
  hasReactionAvailable,
  isLeavingReach,
  isWithinReach,
  resetReaction,
  useReaction,
  type OpportunityAttackTrigger,
  type ReactionState,
  type SentinelReactionTrigger,
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

    it("should prevent opportunity attack when observer is charmed by the moving creature", () => {
      const reaction: ReactionState = { reactionUsed: false };
      const trigger = { ...baseTrigger, observerCharmedByTarget: true };
      const result = canMakeOpportunityAttack(reaction, trigger);

      expect(result.canAttack).toBe(false);
      expect(result.reason).toBe("charmed-by-target");
    });

    it("should allow opportunity attack when observerCharmedByTarget is false", () => {
      const reaction: ReactionState = { reactionUsed: false };
      const trigger = { ...baseTrigger, observerCharmedByTarget: false };
      const result = canMakeOpportunityAttack(reaction, trigger);

      expect(result.canAttack).toBe(true);
    });

    it("should prevent opportunity attack for involuntary movement (teleportation, push, pull)", () => {
      const reaction: ReactionState = { reactionUsed: false };
      const trigger = { ...baseTrigger, involuntaryMovement: true };
      const result = canMakeOpportunityAttack(reaction, trigger);

      expect(result.canAttack).toBe(false);
      expect(result.reason).toBe("involuntary-movement");
    });

    it("should allow opportunity attack when involuntaryMovement is false", () => {
      const reaction: ReactionState = { reactionUsed: false };
      const trigger = { ...baseTrigger, involuntaryMovement: false };
      const result = canMakeOpportunityAttack(reaction, trigger);

      expect(result.canAttack).toBe(true);
    });

    it("should allow opportunity attack when involuntaryMovement is undefined (voluntary)", () => {
      const reaction: ReactionState = { reactionUsed: false };
      const result = canMakeOpportunityAttack(reaction, baseTrigger);

      expect(result.canAttack).toBe(true);
    });

    it("should set canCastSpellAsOA when warCasterEnabled is true and attack is allowed", () => {
      const reaction: ReactionState = { reactionUsed: false };
      const trigger = { ...baseTrigger, warCasterEnabled: true };
      const result = canMakeOpportunityAttack(reaction, trigger);

      expect(result.canAttack).toBe(true);
      expect(result.canCastSpellAsOA).toBe(true);
    });

    it("should not set canCastSpellAsOA when warCasterEnabled is false", () => {
      const reaction: ReactionState = { reactionUsed: false };
      const trigger = { ...baseTrigger, warCasterEnabled: false };
      const result = canMakeOpportunityAttack(reaction, trigger);

      expect(result.canAttack).toBe(true);
      expect(result.canCastSpellAsOA).toBeUndefined();
    });

    it("should not set canCastSpellAsOA when warCasterEnabled is undefined", () => {
      const reaction: ReactionState = { reactionUsed: false };
      const result = canMakeOpportunityAttack(reaction, baseTrigger);

      expect(result.canAttack).toBe(true);
      expect(result.canCastSpellAsOA).toBeUndefined();
    });

    it("should not set canCastSpellAsOA when attack is not allowed even with War Caster", () => {
      const reaction: ReactionState = { reactionUsed: true };
      const trigger = { ...baseTrigger, warCasterEnabled: true };
      const result = canMakeOpportunityAttack(reaction, trigger);

      expect(result.canAttack).toBe(false);
      expect(result.canCastSpellAsOA).toBeUndefined();
    });

    // --- Sentinel feat ---
    it("should allow OA when target disengaged but observer has Sentinel", () => {
      const reaction: ReactionState = { reactionUsed: false };
      const trigger = { ...baseTrigger, disengaged: true, sentinelEnabled: true };
      const result = canMakeOpportunityAttack(reaction, trigger);

      expect(result.canAttack).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("should still block OA when disengaged and no Sentinel", () => {
      const reaction: ReactionState = { reactionUsed: false };
      const trigger = { ...baseTrigger, disengaged: true, sentinelEnabled: false };
      const result = canMakeOpportunityAttack(reaction, trigger);

      expect(result.canAttack).toBe(false);
      expect(result.reason).toBe("disengaged");
    });

    it("should set reducesSpeedToZero when Sentinel enabled and attack allowed", () => {
      const reaction: ReactionState = { reactionUsed: false };
      const trigger = { ...baseTrigger, sentinelEnabled: true };
      const result = canMakeOpportunityAttack(reaction, trigger);

      expect(result.canAttack).toBe(true);
      expect(result.reducesSpeedToZero).toBe(true);
    });

    it("should set reducesSpeedToZero on Sentinel OA that overrides disengage", () => {
      const reaction: ReactionState = { reactionUsed: false };
      const trigger = { ...baseTrigger, disengaged: true, sentinelEnabled: true };
      const result = canMakeOpportunityAttack(reaction, trigger);

      expect(result.canAttack).toBe(true);
      expect(result.reducesSpeedToZero).toBe(true);
    });

    it("should not set reducesSpeedToZero without Sentinel", () => {
      const reaction: ReactionState = { reactionUsed: false };
      const result = canMakeOpportunityAttack(reaction, baseTrigger);

      expect(result.canAttack).toBe(true);
      expect(result.reducesSpeedToZero).toBeUndefined();
    });

    it("should not set reducesSpeedToZero when attack not allowed even with Sentinel", () => {
      const reaction: ReactionState = { reactionUsed: true };
      const trigger = { ...baseTrigger, sentinelEnabled: true };
      const result = canMakeOpportunityAttack(reaction, trigger);

      expect(result.canAttack).toBe(false);
      expect(result.reducesSpeedToZero).toBeUndefined();
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

  describe("canMakeSentinelReaction (Effect #3)", () => {
    const baseTrigger: SentinelReactionTrigger = {
      observerHasSentinel: true,
      observerHasReaction: true,
      observerIncapacitated: false,
      distanceToAttacker: 5,
      observerIsTarget: false,
    };

    it("should allow reaction when all conditions met", () => {
      const result = canMakeSentinelReaction(baseTrigger);
      expect(result.canReact).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("should deny when observer does not have Sentinel feat", () => {
      const result = canMakeSentinelReaction({ ...baseTrigger, observerHasSentinel: false });
      expect(result.canReact).toBe(false);
      expect(result.reason).toBe("no-sentinel");
    });

    it("should deny when observer has no reaction available", () => {
      const result = canMakeSentinelReaction({ ...baseTrigger, observerHasReaction: false });
      expect(result.canReact).toBe(false);
      expect(result.reason).toBe("no-reaction");
    });

    it("should deny when observer is incapacitated", () => {
      const result = canMakeSentinelReaction({ ...baseTrigger, observerIncapacitated: true });
      expect(result.canReact).toBe(false);
      expect(result.reason).toBe("incapacitated");
    });

    it("should deny when attacker is more than 5 feet away", () => {
      const result = canMakeSentinelReaction({ ...baseTrigger, distanceToAttacker: 10 });
      expect(result.canReact).toBe(false);
      expect(result.reason).toBe("too-far");
    });

    it("should allow when attacker is exactly 5 feet away", () => {
      const result = canMakeSentinelReaction({ ...baseTrigger, distanceToAttacker: 5 });
      expect(result.canReact).toBe(true);
    });

    it("should deny when observer IS the target of the attack", () => {
      const result = canMakeSentinelReaction({ ...baseTrigger, observerIsTarget: true });
      expect(result.canReact).toBe(false);
      expect(result.reason).toBe("is-target");
    });
  });
});
