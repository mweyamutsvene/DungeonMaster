/**
 * Unit tests for Ability Registry
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { AbilityRegistry } from "./ability-registry.js";
import { NimbleEscapeExecutor, CunningActionExecutor } from "./executors/index.js";

describe("AbilityRegistry", () => {
  let registry: AbilityRegistry;

  beforeEach(() => {
    registry = new AbilityRegistry();
  });

  describe("NimbleEscapeExecutor", () => {
    beforeEach(() => {
      registry.register(new NimbleEscapeExecutor());
    });

    it("should match monster:bonus:nimble-escape", () => {
      expect(registry.hasExecutor("monster:bonus:nimble-escape")).toBe(true);
    });

    it("should match LLM-friendly 'Nimble Escape'", () => {
      expect(registry.hasExecutor("Nimble Escape")).toBe(true);
    });

    it("should match legacy nimble_escape_disengage", () => {
      expect(registry.hasExecutor("nimble_escape_disengage")).toBe(true);
    });

    it("should match legacy nimble_escape_hide", () => {
      expect(registry.hasExecutor("nimble_escape_hide")).toBe(true);
    });

    it("should execute disengage via nimble_escape_disengage", async () => {
      const mockDisengage = vi.fn().mockResolvedValue(undefined);
      
      const result = await registry.execute({
        sessionId: "test-session",
        encounterId: "test-encounter",
        actor: {} as any,
        combat: {} as any,
        abilityId: "nimble_escape_disengage",
        params: {
          actor: { type: "Monster", monsterId: "goblin-1" },
        },
        services: {
          disengage: mockDisengage,
          dash: vi.fn(),
          dodge: vi.fn(),
          hide: vi.fn(),
          attack: vi.fn(),
        },
      });

      expect(result.success).toBe(true);
      if (!result.success) {
        console.log("Execution failed:", result.error, result.summary);
      }
      expect(mockDisengage).toHaveBeenCalledWith({
        encounterId: "test-encounter",
        actor: { type: "Monster", monsterId: "goblin-1" },
      });
    });
  });

  describe("CunningActionExecutor", () => {
    beforeEach(() => {
      registry.register(new CunningActionExecutor());
    });

    it("should match class:rogue:cunning-action", () => {
      expect(registry.hasExecutor("class:rogue:cunning-action")).toBe(true);
    });

    it("should match LLM-friendly 'Cunning Action'", () => {
      expect(registry.hasExecutor("Cunning Action")).toBe(true);
    });

    it("should match legacy cunning_action_dash", () => {
      expect(registry.hasExecutor("cunning_action_dash")).toBe(true);
    });

    it("should execute dash via cunning_action_dash", async () => {
      const mockDash = vi.fn().mockResolvedValue(undefined);
      
      const result = await registry.execute({
        sessionId: "test-session",
        encounterId: "test-encounter",
        actor: {} as any,
        combat: {} as any,
        abilityId: "cunning_action_dash",
        params: {
          actor: { type: "Character", characterId: "rogue-1" },
          className: "rogue",
          level: 2,
        },
        services: {
          disengage: vi.fn(),
          dash: mockDash,
          dodge: vi.fn(),
          hide: vi.fn(),
          attack: vi.fn(),
        },
      });

      expect(result.success).toBe(true);
      expect(mockDash).toHaveBeenCalledWith({
        encounterId: "test-encounter",
        actor: { type: "Character", characterId: "rogue-1" },
      });
    });
  });
});
