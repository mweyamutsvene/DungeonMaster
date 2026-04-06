import { describe, it, expect } from "vitest";
import { isFlanking, checkFlanking } from "./flanking.js";
import type { Position } from "./movement.js";

describe("isFlanking", () => {
  const GRID = 5;
  const target: Position = { x: 10, y: 10 };

  it("detects flanking on opposite sides (east–west)", () => {
    const attacker: Position = { x: 5, y: 10 };  // west of target
    const ally: Position = { x: 15, y: 10 };       // east of target
    expect(isFlanking(attacker, target, ally, GRID)).toBe(true);
  });

  it("detects flanking on opposite sides (north–south)", () => {
    const attacker: Position = { x: 10, y: 5 };   // north of target
    const ally: Position = { x: 10, y: 15 };       // south of target
    expect(isFlanking(attacker, target, ally, GRID)).toBe(true);
  });

  it("detects flanking on diagonal corners (NW–SE)", () => {
    const attacker: Position = { x: 5, y: 5 };     // NW
    const ally: Position = { x: 15, y: 15 };        // SE
    expect(isFlanking(attacker, target, ally, GRID)).toBe(true);
  });

  it("detects flanking on diagonal corners (NE–SW)", () => {
    const attacker: Position = { x: 15, y: 5 };    // NE
    const ally: Position = { x: 5, y: 15 };         // SW
    expect(isFlanking(attacker, target, ally, GRID)).toBe(true);
  });

  it("returns false when attacker and ally are on the same side", () => {
    const attacker: Position = { x: 5, y: 10 };    // west
    const ally: Position = { x: 5, y: 5 };          // NW (same western quadrant)
    expect(isFlanking(attacker, target, ally, GRID)).toBe(false);
  });

  it("returns false when attacker and ally are on adjacent sides (not opposite)", () => {
    const attacker: Position = { x: 5, y: 10 };    // west
    const ally: Position = { x: 10, y: 5 };         // north
    expect(isFlanking(attacker, target, ally, GRID)).toBe(false);
  });

  it("returns false when ally is not adjacent to target", () => {
    const attacker: Position = { x: 5, y: 10 };    // west, adjacent
    const ally: Position = { x: 20, y: 10 };        // 10ft east — too far
    expect(isFlanking(attacker, target, ally, GRID)).toBe(false);
  });

  it("returns false when attacker is not adjacent to target", () => {
    const attacker: Position = { x: 0, y: 10 };    // 10ft west — too far
    const ally: Position = { x: 15, y: 10 };        // east, adjacent
    expect(isFlanking(attacker, target, ally, GRID)).toBe(false);
  });

  it("returns false when attacker and ally are on the same cell", () => {
    const attacker: Position = { x: 5, y: 10 };
    const ally: Position = { x: 5, y: 10 };
    expect(isFlanking(attacker, target, ally, GRID)).toBe(false);
  });
});

describe("checkFlanking", () => {
  const target: Position = { x: 10, y: 10 };

  it("returns true when at least one ally creates a flanking pair", () => {
    const attacker: Position = { x: 5, y: 10 };
    const allies: Position[] = [
      { x: 10, y: 5 },   // north — not opposite to west
      { x: 15, y: 10 },  // east — OPPOSITE to west → flanking
    ];
    expect(checkFlanking(attacker, target, allies)).toBe(true);
  });

  it("returns false when no ally creates a flanking pair", () => {
    const attacker: Position = { x: 5, y: 10 };
    const allies: Position[] = [
      { x: 10, y: 5 },  // north
      { x: 5, y: 5 },   // NW (same side)
    ];
    expect(checkFlanking(attacker, target, allies)).toBe(false);
  });

  it("returns false with empty allies array", () => {
    const attacker: Position = { x: 5, y: 10 };
    expect(checkFlanking(attacker, target, [])).toBe(false);
  });

  it("works with non-default grid size", () => {
    const attacker: Position = { x: 0, y: 10 };
    const ally: Position = { x: 20, y: 10 };
    // gridSize=10: both 10ft away (one step), midpoint = (10,10) = target
    expect(checkFlanking(attacker, target, [ally], 10)).toBe(true);
  });
});
