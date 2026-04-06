import { describe, expect, it } from "vitest";

import {
  createMovementState,
  pushAwayFrom,
  pullToward,
  snapToGrid,
} from "./movement.js";
import type { Position } from "./movement.js";

describe("snapToGrid", () => {
  it("snaps fractional coordinates to nearest 5ft grid point", () => {
    expect(snapToGrid({ x: 7, y: 13 })).toEqual({ x: 5, y: 15, elevation: undefined });
    expect(snapToGrid({ x: 12.5, y: 17.5 })).toEqual({ x: 15, y: 20, elevation: undefined });
  });

  it("leaves already-aligned coordinates unchanged", () => {
    expect(snapToGrid({ x: 10, y: 25 })).toEqual({ x: 10, y: 25, elevation: undefined });
  });

  it("preserves elevation", () => {
    expect(snapToGrid({ x: 3, y: 8, elevation: 10 })).toEqual({ x: 5, y: 10, elevation: 10 });
  });
});

describe("pushAwayFrom — grid alignment", () => {
  it("push result is grid-aligned (cardinal direction)", () => {
    const state = createMovementState({ x: 10, y: 10 }, 30);
    const source: Position = { x: 10, y: 0 };
    const result = pushAwayFrom(state, source, 10);

    expect(result.position.x % 5).toBe(0);
    expect(result.position.y % 5).toBe(0);
    // Push away from y=0 should move y upward
    expect(result.position.y).toBe(20);
    expect(result.position.x).toBe(10);
  });

  it("push result snaps diagonal movement to grid", () => {
    // Creature at (10,10), source at (0,0), push 10ft along diagonal
    const state = createMovementState({ x: 10, y: 10 }, 30);
    const source: Position = { x: 0, y: 0 };
    const result = pushAwayFrom(state, source, 10);

    // Diagonal push: 10 * (1/√2) ≈ 7.07 per axis → snaps to nearest 5ft
    expect(result.position.x % 5).toBe(0);
    expect(result.position.y % 5).toBe(0);
    // Should be pushed further from origin
    expect(result.position.x).toBeGreaterThan(10);
    expect(result.position.y).toBeGreaterThan(10);
  });

  it("push from same position snaps to grid", () => {
    const state = createMovementState({ x: 7, y: 7 }, 30);
    const source: Position = { x: 7, y: 7 };
    const result = pushAwayFrom(state, source, 10);

    expect(result.position.x % 5).toBe(0);
    expect(result.position.y % 5).toBe(0);
  });
});

describe("pullToward — grid alignment", () => {
  it("pull result is grid-aligned (cardinal direction)", () => {
    const state = createMovementState({ x: 30, y: 10 }, 30);
    const source: Position = { x: 10, y: 10 };
    const result = pullToward(state, source, 10);

    expect(result.position.x % 5).toBe(0);
    expect(result.position.y % 5).toBe(0);
    expect(result.position.x).toBe(20);
    expect(result.position.y).toBe(10);
  });

  it("pull result snaps diagonal movement to grid", () => {
    const state = createMovementState({ x: 20, y: 20 }, 30);
    const source: Position = { x: 0, y: 0 };
    const result = pullToward(state, source, 10);

    expect(result.position.x % 5).toBe(0);
    expect(result.position.y % 5).toBe(0);
    // Should be pulled closer to origin
    expect(result.position.x).toBeLessThan(20);
    expect(result.position.y).toBeLessThan(20);
  });

  it("pull does not overshoot source position", () => {
    const state = createMovementState({ x: 15, y: 10 }, 30);
    const source: Position = { x: 10, y: 10 };
    const result = pullToward(state, source, 20);

    // Only 5ft apart, so should stop at source — snapped to grid
    expect(result.position.x).toBe(10);
    expect(result.position.y).toBe(10);
  });
});
