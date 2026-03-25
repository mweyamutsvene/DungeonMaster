/**
 * Unit tests for getCreaturesInArea() — D&D 5e 2024 AoE geometry.
 *
 * Uses cardinal direction (1,0) = right for most tests so the math is easy to
 * reason about:
 *   dAlong = dx  (distance along the cone axis)
 *   dPerp  = |dy| (perpendicular distance from axis)
 *
 * Grid unit: 5ft. All coordinates are in feet.
 */

import { describe, it, expect } from 'vitest';
import { getCreaturesInArea, computeDirection } from './area-of-effect.js';
import type { AreaOfEffect, AreaTarget } from './area-of-effect.js';

// ——————————————————————————————————————————————
// Helpers
// ——————————————————————————————————————————————

function makeTargets(entries: Array<{ id: string; x: number; y: number }>): AreaTarget[] {
  return entries.map(({ id, x, y }) => ({ id, position: { x, y } }));
}

const ORIGIN = { x: 0, y: 0 };
const DIR_RIGHT = { x: 1, y: 0 };

// ——————————————————————————————————————————————
// computeDirection
// ——————————————————————————————————————————————

describe('computeDirection', () => {
  it('returns (1, 0) for rightward direction', () => {
    const dir = computeDirection({ x: 0, y: 0 }, { x: 10, y: 0 });
    expect(dir.x).toBeCloseTo(1);
    expect(dir.y).toBeCloseTo(0);
  });

  it('returns (0, 1) for upward direction', () => {
    const dir = computeDirection({ x: 0, y: 0 }, { x: 0, y: 10 });
    expect(dir.x).toBeCloseTo(0);
    expect(dir.y).toBeCloseTo(1);
  });

  it('returns normalized diagonal direction', () => {
    const dir = computeDirection({ x: 0, y: 0 }, { x: 10, y: 10 });
    const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y);
    expect(len).toBeCloseTo(1);
    expect(dir.x).toBeCloseTo(Math.SQRT1_2);
    expect(dir.y).toBeCloseTo(Math.SQRT1_2);
  });

  it('returns (1, 0) fallback when both positions are identical', () => {
    const dir = computeDirection({ x: 5, y: 5 }, { x: 5, y: 5 });
    expect(dir.x).toBe(1);
    expect(dir.y).toBe(0);
  });
});

// ——————————————————————————————————————————————
// Cone (Burning Hands 15ft, direction right)
// ——————————————————————————————————————————————

describe('getCreaturesInArea — cone', () => {
  const area: AreaOfEffect = { type: 'cone', size: 15 };

  it('includes targets directly in front of caster along axis', () => {
    const targets = makeTargets([
      { id: 'a', x: 5, y: 0 },   // 1 grid unit ahead
      { id: 'b', x: 10, y: 0 },  // 2 grid units ahead
      { id: 'c', x: 15, y: 0 },  // 3 grid units — at max range
    ]);
    const result = getCreaturesInArea(ORIGIN, area, DIR_RIGHT, targets);
    expect(result).toContain('a');
    expect(result).toContain('b');
    expect(result).toContain('c');
  });

  it('excludes targets behind the caster', () => {
    const targets = makeTargets([{ id: 'behind', x: -5, y: 0 }]);
    const result = getCreaturesInArea(ORIGIN, area, DIR_RIGHT, targets);
    expect(result).not.toContain('behind');
  });

  it('excludes targets beyond cone length', () => {
    // 20ft is past the 15ft + half-grid (17.5ft) boundary
    const targets = makeTargets([{ id: 'far', x: 20, y: 0 }]);
    const result = getCreaturesInArea(ORIGIN, area, DIR_RIGHT, targets);
    expect(result).not.toContain('far');
  });

  it('includes targets at width boundary (dPerp == dAlong/2 + HALF_GRID)', () => {
    // At x=10, half-width = 10/2 + 2.5 = 7.5 ft → target at (10, 7) is inside
    const targets = makeTargets([{ id: 'edge', x: 10, y: 7 }]);
    const result = getCreaturesInArea(ORIGIN, area, DIR_RIGHT, targets);
    expect(result).toContain('edge');
  });

  it('excludes targets outside cone width', () => {
    // At x=10, half-width = 7.5 ft → target at (10, 9) is outside
    const targets = makeTargets([{ id: 'wide', x: 10, y: 9 }]);
    const result = getCreaturesInArea(ORIGIN, area, DIR_RIGHT, targets);
    expect(result).not.toContain('wide');
  });

  it('includes a target at the near width boundary at depth 5', () => {
    // At x=5, half-width = 5/2 + 2.5 = 5 ft → target at (5, 5) is exactly at boundary
    const targets = makeTargets([{ id: 'boundary', x: 5, y: 5 }]);
    const result = getCreaturesInArea(ORIGIN, area, DIR_RIGHT, targets);
    expect(result).toContain('boundary');
  });

  it('handles multi-target mix: includes in-cone, excludes out-of-cone', () => {
    const targets = makeTargets([
      { id: 'in1', x: 5, y: 0 },
      { id: 'in2', x: 10, y: 0 },
      { id: 'out-behind', x: -5, y: 0 },
      { id: 'out-far', x: 20, y: 0 },
      { id: 'out-wide', x: 10, y: 10 },
    ]);
    const result = getCreaturesInArea(ORIGIN, area, DIR_RIGHT, targets);
    expect(result).toContain('in1');
    expect(result).toContain('in2');
    expect(result).not.toContain('out-behind');
    expect(result).not.toContain('out-far');
    expect(result).not.toContain('out-wide');
  });

  it('respects excludeIds — skips caster id', () => {
    const targets = makeTargets([
      { id: 'caster', x: 0, y: 0 },
      { id: 'target', x: 5, y: 0 },
    ]);
    const result = getCreaturesInArea(ORIGIN, area, DIR_RIGHT, targets, new Set(['caster']));
    expect(result).not.toContain('caster');
    expect(result).toContain('target');
  });

  it('returns empty array when no targets in area', () => {
    const targets = makeTargets([{ id: 'behind', x: -10, y: 0 }]);
    const result = getCreaturesInArea(ORIGIN, area, DIR_RIGHT, targets);
    expect(result).toHaveLength(0);
  });
});

// ——————————————————————————————————————————————
// Sphere (Fireball 20ft radius — centered AoE)
// ——————————————————————————————————————————————

describe('getCreaturesInArea — sphere', () => {
  const area: AreaOfEffect = { type: 'sphere', size: 20 };
  const center = { x: 20, y: 20 }; // Fireball center

  it('includes targets within the radius', () => {
    const targets = makeTargets([
      { id: 'close', x: 25, y: 20 },  // 5ft away
      { id: 'mid', x: 30, y: 20 },    // 10ft away
      { id: 'edge', x: 40, y: 20 },   // 20ft away — at boundary
    ]);
    const result = getCreaturesInArea(center, area, null, targets);
    expect(result).toContain('close');
    expect(result).toContain('mid');
    expect(result).toContain('edge');
  });

  it('includes targets at the boundary (within radius + HALF_GRID tolerance)', () => {
    // 20ft + 2.5ft tolerance = 22.5ft
    const targets = makeTargets([{ id: 'boundary', x: 20 + 22, y: 20 }]);
    const result = getCreaturesInArea(center, area, null, targets);
    expect(result).toContain('boundary');
  });

  it('excludes targets beyond the radius', () => {
    // 25ft > 20ft + 2.5ft tolerance
    const targets = makeTargets([{ id: 'far', x: 20 + 25, y: 20 }]);
    const result = getCreaturesInArea(center, area, null, targets);
    expect(result).not.toContain('far');
  });

  it('includes targets in all directions from center', () => {
    const targets = makeTargets([
      { id: 'right', x: 30, y: 20 },
      { id: 'left', x: 10, y: 20 },
      { id: 'up', x: 20, y: 30 },
      { id: 'down', x: 20, y: 10 },
      { id: 'diagonal', x: 28, y: 28 }, // ~11.3ft — within 20ft
    ]);
    const result = getCreaturesInArea(center, area, null, targets);
    expect(result).toContain('right');
    expect(result).toContain('left');
    expect(result).toContain('up');
    expect(result).toContain('down');
    expect(result).toContain('diagonal');
  });

  it('direction parameter is ignored for sphere', () => {
    const targets = makeTargets([{ id: 't', x: 10, y: 20 }]);
    // direction pointing right should not affect sphere check
    const withDir = getCreaturesInArea(center, area, DIR_RIGHT, targets);
    const withNull = getCreaturesInArea(center, area, null, targets);
    expect(withDir).toEqual(withNull);
  });
});

// ——————————————————————————————————————————————
// Cylinder (treated same as sphere in 2D projection)
// ——————————————————————————————————————————————

describe('getCreaturesInArea — cylinder', () => {
  const area: AreaOfEffect = { type: 'cylinder', size: 10 };
  const center = { x: 0, y: 0 };

  it('includes targets within radius', () => {
    const targets = makeTargets([
      { id: 'in', x: 8, y: 0 },
      { id: 'out', x: 15, y: 0 },
    ]);
    const result = getCreaturesInArea(center, area, null, targets);
    expect(result).toContain('in');
    expect(result).not.toContain('out');
  });
});

// ——————————————————————————————————————————————
// Cube (Thunderwave 15ft — originates from caster face)
// ——————————————————————————————————————————————

describe('getCreaturesInArea — cube', () => {
  // cube size=15: extends 15ft forward, 7.5ft to each side perpendicular
  const area: AreaOfEffect = { type: 'cube', size: 15 };

  it('includes targets in front of caster within cube dimensions', () => {
    const targets = makeTargets([
      { id: 'front-center', x: 5, y: 0 },
      { id: 'front-side', x: 5, y: 5 },
      { id: 'front-far', x: 14, y: 0 },
    ]);
    const result = getCreaturesInArea(ORIGIN, area, DIR_RIGHT, targets);
    expect(result).toContain('front-center');
    expect(result).toContain('front-side');
    expect(result).toContain('front-far');
  });

  it('excludes targets beyond cube depth', () => {
    // 20ft > 15ft + 2.5ft tolerance
    const targets = makeTargets([{ id: 'too-deep', x: 20, y: 0 }]);
    const result = getCreaturesInArea(ORIGIN, area, DIR_RIGHT, targets);
    expect(result).not.toContain('too-deep');
  });

  it('excludes targets too far to the side', () => {
    // cube half-width tolerance = size/2 + HALF_GRID = 15/2 + 2.5 = 10ft
    // target at y=12 exceeds the 10ft limit → outside
    const targets = makeTargets([{ id: 'too-wide', x: 5, y: 12 }]);
    const result = getCreaturesInArea(ORIGIN, area, DIR_RIGHT, targets);
    expect(result).not.toContain('too-wide');
  });

  it('excludes targets behind origin', () => {
    const targets = makeTargets([{ id: 'behind', x: -5, y: 0 }]);
    const result = getCreaturesInArea(ORIGIN, area, DIR_RIGHT, targets);
    expect(result).not.toContain('behind');
  });

  it('includes target at side boundary', () => {
    // half-width tolerance = size/2 + HALF_GRID = 15/2 + 2.5 = 10ft
    // target at y=9 is well inside the 10ft boundary
    const targets = makeTargets([{ id: 'boundary-side', x: 5, y: 9 }]);
    const result = getCreaturesInArea(ORIGIN, area, DIR_RIGHT, targets);
    expect(result).toContain('boundary-side');
  });
});

// ——————————————————————————————————————————————
// Line (Lightning Bolt 100ft)
// ——————————————————————————————————————————————

describe('getCreaturesInArea — line', () => {
  const area: AreaOfEffect = { type: 'line', size: 100, width: 5 };

  it('includes targets along the line axis within length', () => {
    const targets = makeTargets([
      { id: 'near', x: 10, y: 0 },
      { id: 'mid', x: 50, y: 0 },
      { id: 'far', x: 90, y: 0 },
    ]);
    const result = getCreaturesInArea(ORIGIN, area, DIR_RIGHT, targets);
    expect(result).toContain('near');
    expect(result).toContain('mid');
    expect(result).toContain('far');
  });

  it('excludes targets behind the origin', () => {
    const targets = makeTargets([{ id: 'behind', x: -10, y: 0 }]);
    const result = getCreaturesInArea(ORIGIN, area, DIR_RIGHT, targets);
    expect(result).not.toContain('behind');
  });

  it('excludes targets beyond line length', () => {
    // 100ft + 2.5ft tolerance boundary; target at 110ft is outside
    const targets = makeTargets([{ id: 'too-far', x: 110, y: 0 }]);
    const result = getCreaturesInArea(ORIGIN, area, DIR_RIGHT, targets);
    expect(result).not.toContain('too-far');
  });

  it('excludes targets off the side of the line', () => {
    // default width=5 → half-width=2.5; target at y=6 is outside (6 > 2.5 + 2.5)
    const targets = makeTargets([{ id: 'off-side', x: 20, y: 6 }]);
    const result = getCreaturesInArea(ORIGIN, area, DIR_RIGHT, targets);
    expect(result).not.toContain('off-side');
  });

  it('includes targets within line width', () => {
    // half-width = 2.5 + tolerance 2.5 = 5ft; target at y=4 is inside
    const targets = makeTargets([{ id: 'in-width', x: 20, y: 4 }]);
    const result = getCreaturesInArea(ORIGIN, area, DIR_RIGHT, targets);
    expect(result).toContain('in-width');
  });

  it('respects custom width', () => {
    const wideArea: AreaOfEffect = { type: 'line', size: 100, width: 20 };
    // half-width = 10 + 2.5 = 12.5ft; target at y=12 is inside
    const targets = makeTargets([{ id: 'in-wide', x: 20, y: 12 }]);
    const result = getCreaturesInArea(ORIGIN, wideArea, DIR_RIGHT, targets);
    expect(result).toContain('in-wide');
  });
});

// ——————————————————————————————————————————————
// Edge cases
// ——————————————————————————————————————————————

describe('getCreaturesInArea — edge cases', () => {
  it('returns empty array when target list is empty', () => {
    const area: AreaOfEffect = { type: 'sphere', size: 20 };
    expect(getCreaturesInArea(ORIGIN, area, null, [])).toHaveLength(0);
  });

  it('returns empty array when all targets are excluded via excludeIds', () => {
    const area: AreaOfEffect = { type: 'sphere', size: 20 };
    const targets = makeTargets([{ id: 'a', x: 5, y: 0 }]);
    const result = getCreaturesInArea(ORIGIN, area, null, targets, new Set(['a']));
    expect(result).toHaveLength(0);
  });

  it('defaults to (1,0) direction when null direction passed to cone', () => {
    const area: AreaOfEffect = { type: 'cone', size: 15 };
    const targets = makeTargets([{ id: 'right', x: 5, y: 0 }]);
    // null direction defaults to { x: 1, y: 0 }, so target at x=5 is in cone
    const result = getCreaturesInArea(ORIGIN, area, null, targets);
    expect(result).toContain('right');
  });

  it('handles multiple creatures at same position', () => {
    const area: AreaOfEffect = { type: 'sphere', size: 10 };
    const targets = makeTargets([
      { id: 'a', x: 5, y: 0 },
      { id: 'b', x: 5, y: 0 }, // same position, different id
    ]);
    const result = getCreaturesInArea(ORIGIN, area, null, targets);
    expect(result).toContain('a');
    expect(result).toContain('b');
    expect(result).toHaveLength(2);
  });
});
