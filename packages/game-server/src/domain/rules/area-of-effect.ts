/**
 * Area of Effect targeting — D&D 5e 2024
 *
 * Pure domain geometry for resolving which creatures fall within
 * a spell's area of effect (cone, sphere, cube, line, cylinder).
 *
 * Positions are in feet on a 5ft grid. All checks include a half-grid
 * tolerance (2.5ft) to approximate the "at least half a square" rule.
 */

import type { Position } from './movement.js';

// ——————————————————————————————————————————————
// Types
// ——————————————————————————————————————————————

export type AreaShape = 'cone' | 'sphere' | 'cube' | 'line' | 'cylinder';

/** Defines an area of effect attached to a spell. */
export interface AreaOfEffect {
  /** Shape of the area. */
  readonly type: AreaShape;
  /** Size in feet: cone length, sphere/cylinder radius, cube side length, line length. */
  readonly size: number;
  /** Width in feet — only used for line shapes. Defaults to 5. */
  readonly width?: number;
}

/** A potential target with an ID and grid position. */
export interface AreaTarget {
  readonly id: string;
  readonly position: Position;
}

// ——————————————————————————————————————————————
// Constants
// ——————————————————————————————————————————————

/** Half of a 5ft grid square — used for boundary tolerance. */
const HALF_GRID = 2.5;

// ——————————————————————————————————————————————
// Direction helper
// ——————————————————————————————————————————————

/**
 * Compute a unit direction vector from `from` to `to`.
 * Returns (1, 0) if the two positions are identical.
 */
export function computeDirection(from: Position, to: Position): Position {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len === 0) return { x: 1, y: 0 };
  return { x: dx / len, y: dy / len };
}

// ——————————————————————————————————————————————
// Shape checks (pure geometry)
// ——————————————————————————————————————————————

/**
 * D&D 5e 2024 Cone:
 *   "A Cone's width at a given point along its length is equal to that
 *    point's distance from the Cone's point of origin."
 *
 * The cone extends from `origin` in the given `direction` for `length` feet.
 * At distance d along the axis the half-width is d/2.
 */
function isInCone(
  origin: Position,
  pos: Position,
  direction: Position,
  length: number,
): boolean {
  const dx = pos.x - origin.x;
  const dy = pos.y - origin.y;

  // Projection onto cone axis
  const dAlong = dx * direction.x + dy * direction.y;
  if (dAlong <= 0 || dAlong > length + HALF_GRID) return false;

  // Perpendicular distance from axis
  const dPerp = Math.abs(-dx * direction.y + dy * direction.x);

  // Half-width = dAlong / 2, with half-grid tolerance
  return dPerp <= dAlong / 2 + HALF_GRID;
}

/**
 * Sphere / Cylinder (2D projection):
 *   All positions within `radius` feet of `center`.
 */
function isInSphere(center: Position, pos: Position, radius: number): boolean {
  const dx = pos.x - center.x;
  const dy = pos.y - center.y;
  const dist = Math.sqrt(dx * dx + dy * dy);
  return dist <= radius + HALF_GRID;
}

/**
 * D&D 5e 2024 Cube:
 *   One face of the cube is at the point of origin, extending outward
 *   in the chosen direction for `size` feet, and `size/2` feet to each
 *   side perpendicular to the direction.
 */
function isInCube(
  origin: Position,
  pos: Position,
  direction: Position,
  size: number,
): boolean {
  const dx = pos.x - origin.x;
  const dy = pos.y - origin.y;

  const dAlong = dx * direction.x + dy * direction.y;
  if (dAlong < -HALF_GRID || dAlong > size + HALF_GRID) return false;

  const dPerp = Math.abs(-dx * direction.y + dy * direction.x);
  return dPerp <= size / 2 + HALF_GRID;
}

/**
 * Line:
 *   Extends from `origin` in `direction` for `length` feet,
 *   with a total width (default 5ft).
 */
function isInLine(
  origin: Position,
  pos: Position,
  direction: Position,
  length: number,
  width: number = 5,
): boolean {
  const dx = pos.x - origin.x;
  const dy = pos.y - origin.y;

  const dAlong = dx * direction.x + dy * direction.y;
  if (dAlong <= 0 || dAlong > length + HALF_GRID) return false;

  const dPerp = Math.abs(-dx * direction.y + dy * direction.x);
  return dPerp <= width / 2 + HALF_GRID;
}

// ——————————————————————————————————————————————
// Main entry point
// ——————————————————————————————————————————————

/**
 * Find all creatures inside an area of effect.
 *
 * @param origin    Point of origin (caster position for cone/line/cube;
 *                  center of the area for sphere/cylinder).
 * @param area      Shape + size of the area.
 * @param direction Unit direction vector (required for cone/line/cube; ignored for sphere/cylinder).
 * @param allTargets All potential targets with positions.
 * @param excludeIds IDs to skip (e.g. the caster).
 * @returns Array of target IDs that fall within the area.
 */
export function getCreaturesInArea(
  origin: Position,
  area: AreaOfEffect,
  direction: Position | null,
  allTargets: readonly AreaTarget[],
  excludeIds?: ReadonlySet<string>,
): string[] {
  const dir = direction ?? { x: 1, y: 0 };
  const result: string[] = [];

  for (const target of allTargets) {
    if (excludeIds?.has(target.id)) continue;

    let inside = false;
    switch (area.type) {
      case 'cone':
        inside = isInCone(origin, target.position, dir, area.size);
        break;
      case 'sphere':
      case 'cylinder':
        inside = isInSphere(origin, target.position, area.size);
        break;
      case 'cube':
        inside = isInCube(origin, target.position, dir, area.size);
        break;
      case 'line':
        inside = isInLine(origin, target.position, dir, area.size, area.width);
        break;
    }

    if (inside) result.push(target.id);
  }

  return result;
}
