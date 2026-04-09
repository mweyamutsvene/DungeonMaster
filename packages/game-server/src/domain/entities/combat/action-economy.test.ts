import { describe, it, expect } from "vitest";
import {
  freshActionEconomy,
  withActionSpent,
  withBonusActionSpent,
  withReactionSpent,
  withMovementSpent,
} from "./action-economy.js";

describe("Immutable ActionEconomy helpers", () => {
  it("freshActionEconomy creates a full economy", () => {
    const e = freshActionEconomy(30);
    expect(e.actionAvailable).toBe(true);
    expect(e.bonusActionAvailable).toBe(true);
    expect(e.reactionAvailable).toBe(true);
    expect(e.movementRemainingFeet).toBe(30);
    expect(e.actionsUsed).toEqual([]);
  });

  it("withActionSpent returns new object with action consumed", () => {
    const e = freshActionEconomy(30);
    const next = withActionSpent(e, "Attack");
    expect(next.actionAvailable).toBe(false);
    expect(next.actionsUsed).toEqual(["Attack"]);
    // Original unchanged
    expect(e.actionAvailable).toBe(true);
    expect(e.actionsUsed).toEqual([]);
  });

  it("withActionSpent throws if action already spent", () => {
    const e = withActionSpent(freshActionEconomy(30));
    expect(() => withActionSpent(e)).toThrow("Action already spent");
  });

  it("withBonusActionSpent returns new object", () => {
    const e = freshActionEconomy(30);
    const next = withBonusActionSpent(e);
    expect(next.bonusActionAvailable).toBe(false);
    expect(e.bonusActionAvailable).toBe(true);
  });

  it("withBonusActionSpent throws if already spent", () => {
    const e = withBonusActionSpent(freshActionEconomy(30));
    expect(() => withBonusActionSpent(e)).toThrow("Bonus action already spent");
  });

  it("withReactionSpent returns new object", () => {
    const e = freshActionEconomy(30);
    const next = withReactionSpent(e);
    expect(next.reactionAvailable).toBe(false);
    expect(e.reactionAvailable).toBe(true);
  });

  it("withReactionSpent throws if already spent", () => {
    const e = withReactionSpent(freshActionEconomy(30));
    expect(() => withReactionSpent(e)).toThrow("Reaction already spent");
  });

  it("withMovementSpent deducts feet and returns new object", () => {
    const e = freshActionEconomy(30);
    const next = withMovementSpent(e, 10);
    expect(next.movementRemainingFeet).toBe(20);
    expect(e.movementRemainingFeet).toBe(30);
  });

  it("withMovementSpent returns same object for 0 feet", () => {
    const e = freshActionEconomy(30);
    const next = withMovementSpent(e, 0);
    expect(next).toBe(e);
  });

  it("withMovementSpent throws if not enough remaining", () => {
    const e = freshActionEconomy(10);
    expect(() => withMovementSpent(e, 15)).toThrow("Not enough movement");
  });

  it("withMovementSpent throws on negative feet", () => {
    const e = freshActionEconomy(30);
    expect(() => withMovementSpent(e, -5)).toThrow("Movement feet must be an integer >= 0");
  });
});
