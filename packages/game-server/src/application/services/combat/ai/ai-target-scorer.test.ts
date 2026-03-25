/**
 * Unit tests for AI Target Scorer.
 */
import { describe, it, expect } from "vitest";
import { scoreTargets, type ScoredTarget } from "./ai-target-scorer.js";
import type { AiCombatContext } from "./ai-types.js";

type EnemyEntry = AiCombatContext["enemies"][number];

function makeEnemy(overrides: Partial<EnemyEntry> & { name: string }): EnemyEntry {
  return {
    hp: { current: 50, max: 100, percentage: 50 },
    initiative: 10,
    ...overrides,
  };
}

describe("scoreTargets", () => {
  it("returns empty array when no enemies", () => {
    const result = scoreTargets({ x: 0, y: 0 }, []);
    expect(result).toEqual([]);
  });

  it("filters out dead enemies (0 HP)", () => {
    const enemies: EnemyEntry[] = [
      makeEnemy({ name: "Alive", hp: { current: 30, max: 100, percentage: 30 } }),
      makeEnemy({ name: "Dead", hp: { current: 0, max: 100, percentage: 0 } }),
    ];
    const result = scoreTargets({ x: 0, y: 0 }, enemies);
    expect(result).toHaveLength(1);
    expect(result[0]!.name).toBe("Alive");
  });

  it("ranks low-HP enemies higher (focus fire)", () => {
    const enemies: EnemyEntry[] = [
      makeEnemy({ name: "FullHP", hp: { current: 100, max: 100, percentage: 100 }, position: { x: 1, y: 0 } }),
      makeEnemy({ name: "LowHP", hp: { current: 10, max: 100, percentage: 10 }, position: { x: 1, y: 0 } }),
    ];
    const result = scoreTargets({ x: 0, y: 0 }, enemies);
    expect(result[0]!.name).toBe("LowHP");
  });

  it("ranks concentration casters higher", () => {
    const enemies: EnemyEntry[] = [
      makeEnemy({
        name: "NoConcen",
        hp: { current: 80, max: 100, percentage: 80 },
        position: { x: 1, y: 0 },
      }),
      makeEnemy({
        name: "Concentrator",
        hp: { current: 80, max: 100, percentage: 80 },
        concentrationSpell: "Spirit Guardians",
        position: { x: 1, y: 0 },
      }),
    ];
    const result = scoreTargets({ x: 0, y: 0 }, enemies);
    expect(result[0]!.name).toBe("Concentrator");
  });

  it("ranks stunned enemies higher (easy target)", () => {
    const enemies: EnemyEntry[] = [
      makeEnemy({
        name: "Normal",
        hp: { current: 80, max: 100, percentage: 80 },
        position: { x: 1, y: 0 },
      }),
      makeEnemy({
        name: "Stunned",
        hp: { current: 80, max: 100, percentage: 80 },
        conditions: ["Stunned"],
        position: { x: 1, y: 0 },
      }),
    ];
    const result = scoreTargets({ x: 0, y: 0 }, enemies);
    expect(result[0]!.name).toBe("Stunned");
  });

  it("ranks paralyzed enemies very high (auto-crit)", () => {
    const enemies: EnemyEntry[] = [
      makeEnemy({
        name: "Stunned",
        hp: { current: 80, max: 100, percentage: 80 },
        conditions: ["Stunned"],
        position: { x: 1, y: 0 },
      }),
      makeEnemy({
        name: "Paralyzed",
        hp: { current: 80, max: 100, percentage: 80 },
        conditions: ["Paralyzed"],
        position: { x: 1, y: 0 },
      }),
    ];
    const result = scoreTargets({ x: 0, y: 0 }, enemies);
    expect(result[0]!.name).toBe("Paralyzed");
  });

  it("prefers closer targets over distant ones", () => {
    const enemies: EnemyEntry[] = [
      makeEnemy({
        name: "Far",
        hp: { current: 50, max: 100, percentage: 50 },
        position: { x: 10, y: 0 },
        distanceFeet: 50,
      }),
      makeEnemy({
        name: "Close",
        hp: { current: 50, max: 100, percentage: 50 },
        position: { x: 1, y: 0 },
        distanceFeet: 5,
      }),
    ];
    const result = scoreTargets({ x: 0, y: 0 }, enemies);
    expect(result[0]!.name).toBe("Close");
  });

  it("ranks low AC enemies higher (easier to hit)", () => {
    const enemies: EnemyEntry[] = [
      makeEnemy({
        name: "HighAC",
        hp: { current: 50, max: 100, percentage: 50 },
        ac: 20,
        position: { x: 1, y: 0 },
      }),
      makeEnemy({
        name: "LowAC",
        hp: { current: 50, max: 100, percentage: 50 },
        ac: 10,
        position: { x: 1, y: 0 },
      }),
    ];
    const result = scoreTargets({ x: 0, y: 0 }, enemies);
    expect(result[0]!.name).toBe("LowAC");
  });

  it("computes distance from self position when distanceFeet not provided", () => {
    const enemies: EnemyEntry[] = [
      makeEnemy({
        name: "Target",
        hp: { current: 50, max: 100, percentage: 50 },
        position: { x: 2, y: 0 },
      }),
    ];
    const result = scoreTargets({ x: 0, y: 0 }, enemies);
    expect(result[0]!.distanceFeet).toBe(10); // 2 cells * 5ft
  });

  it("handles missing self position gracefully", () => {
    const enemies: EnemyEntry[] = [
      makeEnemy({ name: "Target", hp: { current: 50, max: 100, percentage: 50 } }),
    ];
    const result = scoreTargets(undefined, enemies);
    expect(result).toHaveLength(1);
    expect(result[0]!.distanceFeet).toBe(Infinity);
  });

  it("balances multiple scoring factors", () => {
    // A low-HP concentration caster far away vs a full-HP close enemy
    // The concentration caster should still win due to compound bonuses
    const enemies: EnemyEntry[] = [
      makeEnemy({
        name: "CloseFullHP",
        hp: { current: 100, max: 100, percentage: 100 },
        position: { x: 1, y: 0 },
        distanceFeet: 5,
      }),
      makeEnemy({
        name: "FarConcentrator",
        hp: { current: 20, max: 100, percentage: 20 },
        concentrationSpell: "Spirit Guardians",
        position: { x: 6, y: 0 },
        distanceFeet: 30,
      }),
    ];
    const result = scoreTargets({ x: 0, y: 0 }, enemies);
    // Far concentrator: 80 (hp missing) + 40 (concentration) - 12 (distance) = 108
    // Close full HP: 0 (hp missing) - 2 (distance) = -2
    expect(result[0]!.name).toBe("FarConcentrator");
  });
});
