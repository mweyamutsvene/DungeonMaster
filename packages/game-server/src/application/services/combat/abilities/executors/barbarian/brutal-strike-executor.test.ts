import { describe, expect, it } from "vitest";

import { BrutalStrikeExecutor } from "./brutal-strike-executor.js";
import { createEffect } from "../../../../../../domain/entities/combat/effects.js";
import type { AbilityExecutionContext } from "../../../../../../domain/abilities/ability-executor.js";

const mockActor = {
  getId: () => "char-1",
  getName: () => "Grimjaw",
  getCurrentHP: () => 50,
  getMaxHP: () => 50,
  getSpeed: () => 30,
  modifyHP: (_amount: number) => ({ actualChange: 0 }),
};

const mockCombat = {
  hasUsedAction: (_creatureId: string, _actionType: string) => false,
  getRound: () => 1,
  getTurnIndex: () => 0,
  addEffect: (_creatureId: string, _effect: unknown) => {},
  getPosition: (_creatureId: string) => undefined,
  setPosition: (_creatureId: string, _pos: { x: number; y: number; elevation?: number }) => {},
};

function buildContext(overrides?: Partial<AbilityExecutionContext>): AbilityExecutionContext {
  return {
    sessionId: "session-1",
    encounterId: "encounter-1",
    actor: mockActor,
    combat: mockCombat,
    abilityId: "class:barbarian:brutal-strike",
    services: {},
    params: {
      actor: { type: "Character", characterId: "char-1" },
      target: { type: "Monster", monsterId: "monster-1" },
      targetId: "monster-1",
      className: "barbarian",
      level: 9,
      resources: {
        raging: true,
        activeEffects: [
          createEffect("reckless", "advantage", "melee_attack_rolls", "until_start_of_next_turn", {
            source: "Reckless Attack",
          }),
        ],
      },
      weaponDamageDice: "1d12",
    },
    ...overrides,
  };
}

describe("BrutalStrikeExecutor", () => {
  it("fails when not raging", async () => {
    const executor = new BrutalStrikeExecutor();
    const context = buildContext({
      params: {
        ...(buildContext().params as Record<string, unknown>),
        resources: {
          raging: false,
          activeEffects: [
            createEffect("reckless", "advantage", "melee_attack_rolls", "until_start_of_next_turn", {
              source: "Reckless Attack",
            }),
          ],
        },
      },
    });

    const result = await executor.execute(context);

    expect(result.success).toBe(false);
    expect(result.error).toBe("NOT_RAGING");
  });

  it("fails when reckless attack was not used", async () => {
    const executor = new BrutalStrikeExecutor();
    const context = buildContext({
      params: {
        ...(buildContext().params as Record<string, unknown>),
        resources: {
          raging: true,
          activeEffects: [],
        },
      },
    });

    const result = await executor.execute(context);

    expect(result.success).toBe(false);
    expect(result.error).toBe("RECKLESS_ATTACK_NOT_USED");
  });

  it("selects forceful blow variant from abilityId", async () => {
    const executor = new BrutalStrikeExecutor();
    const context = buildContext({ abilityId: "forceful-blow" });

    const result = await executor.execute(context);

    expect(result.success).toBe(true);
    expect(result.data?.brutalStrikeVariant).toBe("forceful-blow");
    expect(result.data?.brutalStrikeTargetId).toBe("monster-1");
  });

  it("defaults to hamstring blow when no variant hint is provided", async () => {
    const executor = new BrutalStrikeExecutor();
    const context = buildContext();

    const result = await executor.execute(context);

    expect(result.success).toBe(true);
    expect(result.data?.brutalStrikeVariant).toBe("hamstring-blow");
    expect(result.data?.brutalStrikeBonusDice).toBe("1d12");
  });
});
