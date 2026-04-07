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
});
