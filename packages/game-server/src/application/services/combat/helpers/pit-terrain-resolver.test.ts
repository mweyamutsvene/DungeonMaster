import { describe, expect, it } from "vitest";

import { createCombatMap, setTerrainAt } from "../../../../domain/rules/combat-map.js";
import { FixedDiceRoller } from "../../../../domain/rules/dice-roller.js";
import { resolvePitEntry } from "./pit-terrain-resolver.js";

describe("resolvePitEntry", () => {
  it("applies prone and no damage on successful dex save", () => {
    let map = createCombatMap({
      id: "pit-map",
      name: "Pit Map",
      width: 30,
      height: 30,
      gridSize: 5,
    });
    map = setTerrainAt(map, { x: 10, y: 5 }, "pit", { terrainDepth: 20 });

    const result = resolvePitEntry(
      map,
      { x: 5, y: 5 },
      { x: 10, y: 5 },
      10,
      20,
      [],
      new FixedDiceRoller(20),
    );

    expect(result.triggered).toBe(true);
    expect(result.saved).toBe(true);
    expect(result.damageApplied).toBe(0);
    expect(result.hpAfter).toBe(20);
    expect(result.movementEnds).toBe(true);
    expect(result.updatedConditions.some((c) => c.condition === "Prone")).toBe(true);
  });

  it("applies fall damage on failed dex save", () => {
    let map = createCombatMap({
      id: "pit-map",
      name: "Pit Map",
      width: 30,
      height: 30,
      gridSize: 5,
    });
    map = setTerrainAt(map, { x: 10, y: 5 }, "pit", { terrainDepth: 20 });

    const result = resolvePitEntry(
      map,
      { x: 5, y: 5 },
      { x: 10, y: 5 },
      10,
      20,
      [],
      new FixedDiceRoller([1, 4, 5]),
    );

    expect(result.triggered).toBe(true);
    expect(result.saved).toBe(false);
    expect(result.damageApplied).toBe(9);
    expect(result.hpAfter).toBe(11);
    expect(result.movementEnds).toBe(true);
  });

  it("does not trigger when already in pit terrain", () => {
    let map = createCombatMap({
      id: "pit-map",
      name: "Pit Map",
      width: 30,
      height: 30,
      gridSize: 5,
    });
    map = setTerrainAt(map, { x: 5, y: 5 }, "pit", { terrainDepth: 20 });
    map = setTerrainAt(map, { x: 10, y: 5 }, "pit", { terrainDepth: 20 });

    const result = resolvePitEntry(
      map,
      { x: 5, y: 5 },
      { x: 10, y: 5 },
      10,
      20,
      [],
      new FixedDiceRoller(1),
    );

    expect(result.triggered).toBe(false);
    expect(result.hpAfter).toBe(20);
  });

  describe("Slow Fall (Monk L4+)", () => {
    function makeMap() {
      let map = createCombatMap({
        id: "pit-map",
        name: "Pit Map",
        width: 30,
        height: 30,
        gridSize: 5,
      });
      map = setTerrainAt(map, { x: 10, y: 5 }, "pit", { terrainDepth: 30 });
      return map;
    }

    it("reduces fall damage by 5 × Monk level when reaction is available", () => {
      // 30ft pit with FixedDiceRoller([1, 4, 5]) for save fail then 3d6 = 4+5+1 = 10 damage.
      // Wait — actually the dice queue is shared; FixedDiceRoller cycles. Let's pin save fail + reasonable damage.
      const result = resolvePitEntry(
        makeMap(),
        { x: 5, y: 5 },
        { x: 10, y: 5 },
        10,
        50,
        [],
        new FixedDiceRoller([1, 6, 6, 6]),  // d20=1 save fail; 3d6 fall = 18 dmg
        { monkLevel: 4, hasReaction: true },
      );

      expect(result.triggered).toBe(true);
      expect(result.saved).toBe(false);
      expect(result.damageBeforeReduction).toBe(18);
      expect(result.slowFallReduction).toBe(20); // 5 × L4
      expect(result.damageApplied).toBe(0);       // 18 - 20 clamped to 0
      expect(result.hpAfter).toBe(50);            // no HP loss
    });

    it("does NOT apply Slow Fall when monkLevel < 4", () => {
      const result = resolvePitEntry(
        makeMap(),
        { x: 5, y: 5 },
        { x: 10, y: 5 },
        10,
        50,
        [],
        new FixedDiceRoller([1, 6, 6, 6]),
        { monkLevel: 3, hasReaction: true },
      );

      expect(result.slowFallReduction).toBe(0);
      expect(result.damageApplied).toBe(18);
    });

    it("does NOT apply Slow Fall when reaction is unavailable", () => {
      const result = resolvePitEntry(
        makeMap(),
        { x: 5, y: 5 },
        { x: 10, y: 5 },
        10,
        50,
        [],
        new FixedDiceRoller([1, 6, 6, 6]),
        { monkLevel: 5, hasReaction: false },
      );

      expect(result.slowFallReduction).toBe(0);
      expect(result.damageApplied).toBe(18);
    });

    it("partial reduction: L4 monk falling far enough that reduction doesn't fully cancel", () => {
      // 30ft fall = 3d6, max 18. With L4 reduction=20, ALL fall damage is cancelled.
      // To get partial reduction, need a deeper pit (60ft = 6d6, avg 21).
      let bigMap = createCombatMap({
        id: "big-pit", name: "Big", width: 30, height: 30, gridSize: 5,
      });
      bigMap = setTerrainAt(bigMap, { x: 10, y: 5 }, "pit", { terrainDepth: 60 });

      const result = resolvePitEntry(
        bigMap,
        { x: 5, y: 5 },
        { x: 10, y: 5 },
        10,
        100,
        [],
        new FixedDiceRoller([1, 6, 6, 6, 6, 6, 6]),  // save fail; 6d6 = 36
        { monkLevel: 4, hasReaction: true },
      );

      expect(result.damageBeforeReduction).toBe(36);
      expect(result.slowFallReduction).toBe(20); // 5 × 4
      expect(result.damageApplied).toBe(16);     // 36 - 20
      expect(result.hpAfter).toBe(84);
    });
  });
});
