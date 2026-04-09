import { describe, it, expect } from "vitest";
import { estimateTokens, truncateContextForLlm } from "./context-budget.js";
import type { AiCombatContext } from "../../application/services/combat/ai/ai-types.js";

describe("context-budget", () => {
  describe("estimateTokens", () => {
    it("estimates rough token count at ~4 chars per token", () => {
      expect(estimateTokens("")).toBe(0);
      expect(estimateTokens("abcd")).toBe(1);
      expect(estimateTokens("hello world")).toBe(3); // 11 chars / 4 = 2.75 → ceil 3
      expect(estimateTokens("a".repeat(400))).toBe(100);
    });
  });

  describe("truncateContextForLlm", () => {
    function makeMinimalContext(overrides?: Partial<AiCombatContext>): AiCombatContext {
      return {
        combatant: {
          name: "Goblin",
          hp: { current: 10, max: 10, percentage: 100 },
          traits: [],
          attacks: [],
          actions: [],
          bonusActions: [],
          reactions: [],
          spells: [],
          abilities: [],
          features: [],
        },
        combat: { round: 1, turn: 1, totalCombatants: 2 },
        allies: [],
        enemies: [{
          name: "Fighter",
          hp: { current: 20, max: 20, percentage: 100 },
          initiative: 15,
        }],
        hasPotions: false,
        recentNarrative: [],
        actionHistory: [],
        turnResults: [],
        lastActionResult: null,
        ...overrides,
      };
    }

    it("returns untruncated context when within budget", () => {
      const ctx = makeMinimalContext();
      const result = truncateContextForLlm(ctx, 10000);
      expect(result.wasTruncated).toBe(false);
      expect(result.context).toBe(ctx); // same reference — no clone needed
    });

    it("summarizes stat block arrays when context exceeds budget", () => {
      const bigTraits = Array.from({ length: 20 }, (_, i) => ({
        name: `Trait ${i}`,
        description: "A very long description that takes up space ".repeat(10),
      }));
      const ctx = makeMinimalContext({
        combatant: {
          name: "Dragon",
          hp: { current: 200, max: 200, percentage: 100 },
          traits: bigTraits,
          attacks: [],
          actions: [],
          bonusActions: [],
          reactions: [],
          spells: [],
          abilities: [],
          features: [],
        },
      });
      // Use a very tight budget to force truncation
      const result = truncateContextForLlm(ctx, 500);
      expect(result.wasTruncated).toBe(true);
      expect(result.truncationNote).toBeDefined();
      // Traits should be summarized to name-only
      const traits = result.context.combatant.traits as Array<{ name: string }>;
      expect(traits.length).toBe(20);
      expect(traits[0]).toEqual({ name: "Trait 0" });
      // Should not have the long description anymore
      expect((traits[0] as any).description).toBeUndefined();
    });

    it("reduces enemy details for large combat", () => {
      const enemies = Array.from({ length: 10 }, (_, i) => ({
        name: `Enemy ${i}`,
        hp: { current: 20, max: 20, percentage: 100 },
        initiative: 10 + i,
        ac: 15,
        speed: 30,
        knownAbilities: ["Multiattack", "Claw", "Bite"],
        position: { x: i * 5, y: 0 },
        distanceFeet: i * 5,
      }));
      const ctx = makeMinimalContext({ enemies });
      // Tight budget
      const result = truncateContextForLlm(ctx, 500);
      expect(result.wasTruncated).toBe(true);
      // Closest enemies should remain at full detail, distant ones reduced
      expect(result.context.enemies.length).toBe(10);
    });

    it("limits recentNarrative when needed", () => {
      const ctx = makeMinimalContext({
        recentNarrative: Array.from({ length: 10 }, (_, i) => `Event ${i}: Something happened on turn ${i} with a very long description that goes on and on to consume tokens`.repeat(5)),
        combatant: {
          name: "Dragon",
          hp: { current: 200, max: 200, percentage: 100 },
          traits: Array.from({ length: 20 }, (_, i) => ({
            name: `T${i}`,
            description: "x".repeat(200),
          })),
          attacks: Array.from({ length: 10 }, (_, i) => ({ name: `Attack ${i}`, damage: "2d6+4", description: "A powerful strike".repeat(10) })),
          actions: Array.from({ length: 10 }, (_, i) => ({ name: `Action ${i}`, description: "Does something complex".repeat(10) })),
          bonusActions: [],
          reactions: [],
          spells: [],
          abilities: Array.from({ length: 10 }, (_, i) => ({ name: `Ability ${i}`, description: "A special ability".repeat(10) })),
          features: Array.from({ length: 10 }, (_, i) => ({ name: `Feature ${i}`, description: "A class feature".repeat(10) })),
        },
        enemies: Array.from({ length: 8 }, (_, i) => ({
          name: `Enemy ${i}`,
          hp: { current: 20, max: 20, percentage: 100 },
          initiative: 10 + i,
          ac: 15,
          speed: 30,
          knownAbilities: ["Multiattack", "Claw", "Bite"],
          position: { x: i * 5, y: 0 },
          distanceFeet: i * 5,
        })),
      });
      const result = truncateContextForLlm(ctx, 500);
      expect(result.wasTruncated).toBe(true);
      expect(result.context.recentNarrative.length).toBeLessThanOrEqual(3);
    });

    it("adds _truncated note to context", () => {
      const bigTraits = Array.from({ length: 20 }, (_, i) => ({
        name: `Trait ${i}`,
        description: "A very long description ".repeat(20),
      }));
      const ctx = makeMinimalContext({
        combatant: {
          name: "Dragon",
          hp: { current: 200, max: 200, percentage: 100 },
          traits: bigTraits,
          attacks: [],
          actions: [],
          bonusActions: [],
          reactions: [],
          spells: [],
          abilities: [],
          features: [],
        },
      });
      const result = truncateContextForLlm(ctx, 500);
      expect(result.wasTruncated).toBe(true);
      expect((result.context as any)._truncated).toBeDefined();
      expect(typeof (result.context as any)._truncated).toBe("string");
    });

    it("does not mutate the original context", () => {
      const bigTraits = Array.from({ length: 20 }, (_, i) => ({
        name: `Trait ${i}`,
        description: "Long description".repeat(50),
      }));
      const ctx = makeMinimalContext({
        combatant: {
          name: "Dragon",
          hp: { current: 200, max: 200, percentage: 100 },
          traits: bigTraits,
          attacks: [],
          actions: [],
          bonusActions: [],
          reactions: [],
          spells: [],
          abilities: [],
          features: [],
        },
      });
      const originalJson = JSON.stringify(ctx);
      truncateContextForLlm(ctx, 500);
      expect(JSON.stringify(ctx)).toBe(originalJson); // original untouched
    });
  });
});
