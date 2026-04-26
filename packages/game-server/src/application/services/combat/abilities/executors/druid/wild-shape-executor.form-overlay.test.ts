import { beforeEach, describe, expect, it } from "vitest";

import { AbilityRegistry } from "../../ability-registry.js";
import type { AbilityExecutionContext } from "../../../../../../domain/abilities/ability-executor.js";
import { WildShapeExecutor } from "./wild-shape-executor.js";

describe("WildShapeExecutor form overlay", () => {
  let registry: AbilityRegistry;

  function setup(): void {
    registry = new AbilityRegistry();
    registry.register(new WildShapeExecutor());
  }

  function makeContext(overrides: Partial<AbilityExecutionContext> = {}): AbilityExecutionContext {
    return {
      sessionId: "session-1",
      encounterId: "encounter-1",
      actor: {
        getId: () => "druid-1",
      } as any,
      combat: {} as any,
      abilityId: "class:druid:wild-shape",
      params: {
        actor: { type: "Character", characterId: "druid-1" },
        className: "druid",
        level: 2,
        sheet: { className: "druid", level: 2 },
        resources: {
          resourcePools: [{ name: "wildShape", current: 2, max: 2 }],
        },
      },
      services: {},
      ...overrides,
    };
  }

  beforeEach(() => setup());

  it("stores form-state object and does not grant temp HP", async () => {
    const result = await registry.execute(makeContext());

    expect(result.success).toBe(true);
    const updatedResources = result.data?.updatedResources as Record<string, unknown>;
    expect(updatedResources).toBeDefined();

    expect(typeof updatedResources.wildShapeForm).toBe("object");
    expect(updatedResources.wildShapeForm).not.toBeNull();

    const wildShapeForm = updatedResources.wildShapeForm as Record<string, unknown>;
    expect(wildShapeForm.formName).toBe("Beast of the Land");
    expect(wildShapeForm.hpRemainingInForm).toBe(10);
    expect(wildShapeForm.maxHp).toBe(10);

    expect(updatedResources.tempHp).toBeUndefined();
    expect(updatedResources.wildShapeActive).toBe(true);
  });
});
