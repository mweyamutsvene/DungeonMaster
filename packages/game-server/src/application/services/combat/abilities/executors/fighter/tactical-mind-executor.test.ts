import { describe, it, expect, beforeEach } from "vitest";
import { AbilityRegistry } from "../../ability-registry.js";
import { TacticalMindExecutor } from "./tactical-mind-executor.js";
import type { AbilityExecutionContext } from "../../../../../../domain/abilities/ability-executor.js";

describe("TacticalMindExecutor", () => {
  let registry: AbilityRegistry;

  function setup() {
    registry = new AbilityRegistry();
    registry.register(new TacticalMindExecutor());
  }

  function makeContext(overrides: Partial<AbilityExecutionContext> = {}): AbilityExecutionContext {
    return {
      sessionId: "sess-1",
      encounterId: "enc-1",
      actor: {} as any,
      combat: {} as any,
      abilityId: "class:fighter:tactical-mind",
      params: {
        actor: { type: "Character", characterId: "fighter-1" },
        sheet: { className: "fighter", level: 2 },
        resources: {
          resourcePools: [{ name: "secondWind", current: 1, max: 1 }],
        },
        className: "fighter",
        level: 2,
      },
      services: {},
      ...overrides,
    };
  }

  beforeEach(() => setup());

  it("matches class:fighter:tactical-mind", () => {
    expect(registry.findExecutor("class:fighter:tactical-mind")).toBeInstanceOf(TacticalMindExecutor);
  });

  it("matches tactical-mind normalized IDs", () => {
    expect(registry.findExecutor("tactical-mind")).toBeInstanceOf(TacticalMindExecutor);
    expect(registry.findExecutor("tactical_mind")).toBeInstanceOf(TacticalMindExecutor);
    expect(registry.findExecutor("Tactical Mind")).toBeInstanceOf(TacticalMindExecutor);
  });

  it("succeeds for Fighter L2+ with Second Wind remaining", async () => {
    const result = await registry.execute(makeContext());
    expect(result.success).toBe(true);
    expect(result.summary).toContain("Tactical Mind");
    expect(result.summary).toContain("reroll");
    expect(result.resourcesSpent).toMatchObject({ secondWind: 1 });
  });

  it("fails with INSUFFICIENT_USES when secondWind is spent", async () => {
    const ctx = makeContext({
      params: {
        ...makeContext().params,
        resources: {
          resourcePools: [{ name: "secondWind", current: 0, max: 1 }],
        },
      },
    });
    const result = await registry.execute(ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBe("INSUFFICIENT_USES");
  });

  it("fails with MISSING_FEATURE for Fighter L1 (no Tactical Mind yet)", async () => {
    const ctx = makeContext({
      params: {
        ...makeContext().params,
        level: 1,
        sheet: { className: "fighter", level: 1 },
      },
    });
    const result = await registry.execute(ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBe("MISSING_FEATURE");
  });

  it("fails with MISSING_FEATURE for non-Fighter", async () => {
    const ctx = makeContext({
      params: {
        ...makeContext().params,
        className: "wizard",
        sheet: { className: "wizard", level: 5 },
      },
    });
    const result = await registry.execute(ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBe("MISSING_FEATURE");
  });

  it("fails with MISSING_ACTOR when actor ref absent", async () => {
    const ctx = makeContext({
      params: { sheet: { className: "fighter", level: 2 }, resources: {} },
    });
    const result = await registry.execute(ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBe("MISSING_ACTOR");
  });

  it("fails with MISSING_RESOURCES when resources absent", async () => {
    const ctx = makeContext({
      params: {
        actor: { type: "Character", characterId: "fighter-1" },
        sheet: { className: "fighter", level: 2 },
        className: "fighter",
        level: 2,
      },
    });
    const result = await registry.execute(ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBe("MISSING_RESOURCES");
  });
});
