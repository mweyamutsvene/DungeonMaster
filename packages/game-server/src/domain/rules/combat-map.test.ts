import { beforeEach, describe, expect, it } from "vitest";
import {
  addEntity,
  createCombatMap,
  getCellAt,
  getCoverLevel,
  getCoverSaveBonus,
  getCreatures,
  getElevationAttackModifier,
  getEntitiesAt,
  getEntitiesInRadius,
  getEntity,
  getFactionsInRange,
  getItems,
  getPitFallDamage,
  getTerrainSpeedModifier,
  hasLineOfSight,
  isElevatedTerrain,
  isOnMap,
  isPitTerrain,
  isPositionPassable,
  moveEntity,
  removeEntity,
  setTerrainAt,
  type CombatMap,
  type MapEntity,
} from "./combat-map.js";

describe("Combat Map", () => {
  describe("createCombatMap", () => {
    it("should create map with default terrain cells", () => {
      const map = createCombatMap({
        id: "test-map",
        name: "Test Arena",
        width: 50,
        height: 50,
        gridSize: 5,
      });

      expect(map.id).toBe("test-map");
      expect(map.width).toBe(50);
      expect(map.height).toBe(50);
      expect(map.gridSize).toBe(5);
      expect(map.cells.length).toBeGreaterThan(0);
      expect(map.entities).toEqual([]);
    });

    it("should default grid size to 5ft", () => {
      const map = createCombatMap({
        id: "test",
        name: "Test",
        width: 30,
        height: 30,
      });

      expect(map.gridSize).toBe(5);
    });
  });

  describe("terrain management", () => {
    it("should get cell at position", () => {
      const map = createCombatMap({
        id: "test",
        name: "Test",
        width: 30,
        height: 30,
      });

      const cell = getCellAt(map, { x: 10, y: 15 });
      expect(cell).toBeTruthy();
      expect(cell?.position.x).toBe(10);
      expect(cell?.position.y).toBe(15);
    });

    it("should set terrain at position", () => {
      let map = createCombatMap({
        id: "test",
        name: "Test",
        width: 30,
        height: 30,
      });

      map = setTerrainAt(map, { x: 10, y: 10 }, "wall");

      const cell = getCellAt(map, { x: 10, y: 10 });
      expect(cell?.terrain).toBe("wall");
      expect(cell?.blocksLineOfSight).toBe(true);
      expect(cell?.passable).toBe(false);
    });

    it("should mark difficult terrain as passable", () => {
      let map = createCombatMap({
        id: "test",
        name: "Test",
        width: 30,
        height: 30,
      });

      map = setTerrainAt(map, { x: 10, y: 10 }, "difficult");

      const cell = getCellAt(map, { x: 10, y: 10 });
      expect(cell?.passable).toBe(true);
      expect(cell?.blocksLineOfSight).toBe(false);
    });
  });

  describe("entity management", () => {
    let map: CombatMap;

    beforeEach(() => {
      map = createCombatMap({
        id: "test",
        name: "Test",
        width: 50,
        height: 50,
      });
    });

    it("should add entity to map", () => {
      const entity: MapEntity = {
        id: "creature1",
        type: "creature",
        position: { x: 10, y: 10 },
        size: "Medium",
        faction: "party",
      };

      map = addEntity(map, entity);

      expect(map.entities).toHaveLength(1);
      expect(map.entities[0]).toEqual(entity);
    });

    it("should move entity on map", () => {
      const entity: MapEntity = {
        id: "creature1",
        type: "creature",
        position: { x: 10, y: 10 },
      };

      map = addEntity(map, entity);
      map = moveEntity(map, "creature1", { x: 20, y: 20 });

      const updated = getEntity(map, "creature1");
      expect(updated?.position).toEqual({ x: 20, y: 20 });
    });

    it("should remove entity from map", () => {
      const entity: MapEntity = {
        id: "creature1",
        type: "creature",
        position: { x: 10, y: 10 },
      };

      map = addEntity(map, entity);
      map = removeEntity(map, "creature1");

      expect(map.entities).toHaveLength(0);
    });

    it("should get entities at position", () => {
      map = addEntity(map, {
        id: "c1",
        type: "creature",
        position: { x: 10, y: 10 },
      });
      map = addEntity(map, {
        id: "c2",
        type: "creature",
        position: { x: 12, y: 10 },
      });
      map = addEntity(map, {
        id: "c3",
        type: "creature",
        position: { x: 30, y: 30 },
      });

      const nearby = getEntitiesAt(map, { x: 10, y: 10 }, 5);

      expect(nearby).toHaveLength(2);
      expect(nearby.find(e => e.id === "c1")).toBeTruthy();
      expect(nearby.find(e => e.id === "c2")).toBeTruthy();
    });

    it("should filter creatures vs items", () => {
      map = addEntity(map, {
        id: "c1",
        type: "creature",
        position: { x: 10, y: 10 },
      });
      map = addEntity(map, {
        id: "i1",
        type: "item",
        position: { x: 15, y: 15 },
      });

      const creatures = getCreatures(map);
      const items = getItems(map);

      expect(creatures).toHaveLength(1);
      expect(items).toHaveLength(1);
    });
  });

  describe("line of sight", () => {
    it("should have clear line of sight without obstacles", () => {
      const map = createCombatMap({
        id: "test",
        name: "Test",
        width: 50,
        height: 50,
      });

      const result = hasLineOfSight(map, { x: 0, y: 0 }, { x: 40, y: 40 });

      expect(result.visible).toBe(true);
    });

    it("should block line of sight with wall", () => {
      let map = createCombatMap({
        id: "test",
        name: "Test",
        width: 50,
        height: 50,
      });

      // Place wall between two points
      map = setTerrainAt(map, { x: 20, y: 20 }, "wall");

      const result = hasLineOfSight(map, { x: 10, y: 10 }, { x: 30, y: 30 });

      expect(result.visible).toBe(false);
      expect(result.blockedBy).toBeTruthy();
    });
  });

  describe("cover calculation", () => {
    it("should return no cover in open terrain", () => {
      const map = createCombatMap({
        id: "test",
        name: "Test",
        width: 50,
        height: 50,
      });

      const cover = getCoverLevel(map, { x: 0, y: 0 }, { x: 30, y: 30 });

      expect(cover).toBe("none");
    });

    it("should detect half cover from cover-half cell on the attacker→target line", () => {
      let map = createCombatMap({
        id: "test",
        name: "Test",
        width: 50,
        height: 50,
      });

      // Attacker (0,0) → Target (30,0): midpoint is (15,0) — place half cover there
      map = setTerrainAt(map, { x: 15, y: 0 }, "cover-half");

      const cover = getCoverLevel(map, { x: 0, y: 0 }, { x: 30, y: 0 });

      expect(cover).toBe("half");
    });

    it("should detect three-quarters cover when that terrain is on the line", () => {
      let map = createCombatMap({
        id: "test",
        name: "Test",
        width: 50,
        height: 50,
      });

      map = setTerrainAt(map, { x: 15, y: 0 }, "cover-three-quarters");

      const cover = getCoverLevel(map, { x: 0, y: 0 }, { x: 30, y: 0 });

      expect(cover).toBe("three-quarters");
    });

    it("should return full cover when a wall is on the attacker→target line", () => {
      let map = createCombatMap({
        id: "test",
        name: "Test",
        width: 50,
        height: 50,
      });

      map = setTerrainAt(map, { x: 15, y: 0 }, "wall");

      const cover = getCoverLevel(map, { x: 0, y: 0 }, { x: 30, y: 0 });

      expect(cover).toBe("full");
    });

    it("should return full cover from explicit cover-full terrain on the line", () => {
      let map = createCombatMap({
        id: "test",
        name: "Test",
        width: 50,
        height: 50,
      });

      map = setTerrainAt(map, { x: 15, y: 0 }, "cover-full");

      const cover = getCoverLevel(map, { x: 0, y: 0 }, { x: 30, y: 0 });

      expect(cover).toBe("full");
    });

    it("should detect half cover from obstacle terrain on the line", () => {
      let map = createCombatMap({
        id: "test",
        name: "Test",
        width: 50,
        height: 50,
      });

      map = setTerrainAt(map, { x: 15, y: 0 }, "obstacle");

      const cover = getCoverLevel(map, { x: 0, y: 0 }, { x: 30, y: 0 });

      expect(cover).toBe("half");
    });

    it("should ignore cover cells that are not on the attacker→target line", () => {
      let map = createCombatMap({
        id: "test",
        name: "Test",
        width: 50,
        height: 50,
      });

      // Perpendicular to the line — should NOT grant cover
      map = setTerrainAt(map, { x: 15, y: 10 }, "cover-half");

      const cover = getCoverLevel(map, { x: 0, y: 0 }, { x: 30, y: 0 });

      expect(cover).toBe("none");
    });

    it("should return the strongest cover when multiple cover cells are on the line", () => {
      let map = createCombatMap({
        id: "test",
        name: "Test",
        width: 50,
        height: 50,
      });

      map = setTerrainAt(map, { x: 10, y: 0 }, "cover-half");
      map = setTerrainAt(map, { x: 20, y: 0 }, "cover-three-quarters");

      const cover = getCoverLevel(map, { x: 0, y: 0 }, { x: 30, y: 0 });

      expect(cover).toBe("three-quarters");
    });

    it("should return none when adjacent combatants have no cells between them", () => {
      const map = createCombatMap({
        id: "test",
        name: "Test",
        width: 50,
        height: 50,
      });

      // Only 1 step apart — no intermediate cells to check
      const cover = getCoverLevel(map, { x: 0, y: 0 }, { x: 5, y: 0 });

      expect(cover).toBe("none");
    });

    it("should detect half cover from diagonal line through a cover cell", () => {
      let map = createCombatMap({
        id: "test",
        name: "Test",
        width: 50,
        height: 50,
      });

      // Diagonal: (10,10) → (30,30) passes through approximately (20,20)
      map = setTerrainAt(map, { x: 20, y: 20 }, "cover-half");

      const cover = getCoverLevel(map, { x: 10, y: 10 }, { x: 30, y: 30 });

      expect(cover).toBe("half");
    });
  });

  describe("radius queries", () => {
    it("should get entities within radius", () => {
      let map = createCombatMap({
        id: "test",
        name: "Test",
        width: 50,
        height: 50,
      });

      map = addEntity(map, {
        id: "c1",
        type: "creature",
        position: { x: 10, y: 10 },
      });
      map = addEntity(map, {
        id: "c2",
        type: "creature",
        position: { x: 15, y: 10 },
      });
      map = addEntity(map, {
        id: "c3",
        type: "creature",
        position: { x: 40, y: 40 },
      });

      const nearby = getEntitiesInRadius(map, { x: 10, y: 10 }, 10);

      expect(nearby).toHaveLength(2);
    });

    it("should separate allies and enemies by faction", () => {
      let map = createCombatMap({
        id: "test",
        name: "Test",
        width: 50,
        height: 50,
      });

      map = addEntity(map, {
        id: "ally1",
        type: "creature",
        position: { x: 10, y: 10 },
        faction: "party",
      });
      map = addEntity(map, {
        id: "ally2",
        type: "creature",
        position: { x: 15, y: 10 },
        faction: "party",
      });
      map = addEntity(map, {
        id: "enemy1",
        type: "creature",
        position: { x: 20, y: 10 },
        faction: "goblins",
      });

      const { allies, enemies } = getFactionsInRange(map, "ally1", 20);

      expect(allies).toHaveLength(1); // ally2
      expect(enemies).toHaveLength(1); // enemy1
    });
  });

  describe("getCoverSaveBonus", () => {
    it("should return +2 for half cover", () => {
      expect(getCoverSaveBonus("half")).toBe(2);
    });

    it("should return +5 for three-quarters cover", () => {
      expect(getCoverSaveBonus("three-quarters")).toBe(5);
    });

    it("should return 0 for no cover", () => {
      expect(getCoverSaveBonus("none")).toBe(0);
    });

    it("should return 0 for full cover", () => {
      expect(getCoverSaveBonus("full")).toBe(0);
    });
  });

  describe("map utilities", () => {
    it("should check if position is on map", () => {
      const map = createCombatMap({
        id: "test",
        name: "Test",
        width: 50,
        height: 50,
      });

      expect(isOnMap(map, { x: 25, y: 25 })).toBe(true);
      expect(isOnMap(map, { x: 60, y: 25 })).toBe(false);
      expect(isOnMap(map, { x: -5, y: 25 })).toBe(false);
    });

    it("should check if position is passable", () => {
      let map = createCombatMap({
        id: "test",
        name: "Test",
        width: 50,
        height: 50,
      });

      expect(isPositionPassable(map, { x: 10, y: 10 })).toBe(true);

      map = setTerrainAt(map, { x: 10, y: 10 }, "wall");
      expect(isPositionPassable(map, { x: 10, y: 10 })).toBe(false);
    });

    it("should get terrain speed modifier", () => {
      let map = createCombatMap({
        id: "test",
        name: "Test",
        width: 50,
        height: 50,
      });

      expect(getTerrainSpeedModifier(map, { x: 10, y: 10 })).toBe(1.0);

      map = setTerrainAt(map, { x: 10, y: 10 }, "difficult");
      expect(getTerrainSpeedModifier(map, { x: 10, y: 10 })).toBe(0.5);

      map = setTerrainAt(map, { x: 15, y: 15 }, "wall");
      expect(getTerrainSpeedModifier(map, { x: 15, y: 15 })).toBe(0);
    });
  });

  describe("elevation / pit terrain utilities", () => {
    it("isElevatedTerrain returns true only for elevated", () => {
      expect(isElevatedTerrain("elevated")).toBe(true);
      expect(isElevatedTerrain("normal")).toBe(false);
      expect(isElevatedTerrain("pit")).toBe(false);
    });

    it("isPitTerrain returns true only for pit", () => {
      expect(isPitTerrain("pit")).toBe(true);
      expect(isPitTerrain("normal")).toBe(false);
      expect(isPitTerrain("elevated")).toBe(false);
    });

    it("attacker on elevated + defender in pit → advantage", () => {
      expect(getElevationAttackModifier("elevated", "pit")).toBe("advantage");
    });

    it("attacker in pit → disadvantage regardless of defender terrain", () => {
      expect(getElevationAttackModifier("pit", "normal")).toBe("disadvantage");
      expect(getElevationAttackModifier("pit", "elevated")).toBe("disadvantage");
    });

    it("normal vs normal → none", () => {
      expect(getElevationAttackModifier("normal", "normal")).toBe("none");
    });

    it("elevated vs normal → none (advantage only when defender in pit)", () => {
      expect(getElevationAttackModifier("elevated", "normal")).toBe("none");
    });

    it("getPitFallDamage returns 1d6", () => {
      expect(getPitFallDamage()).toBe("1d6");
    });
  });
});
