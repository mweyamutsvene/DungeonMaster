import { describe, expect, it } from "vitest";
import {
  attemptMovement,
  calculateDistance,
  calculateHighJumpDistance,
  calculateLongJumpDistance,
  calculateManhattanDistance,
  computeJumpLandingPosition,
  crossesThroughReach,
  getPositionsInRadius,
  isWithinMeleeReach,
  isWithinRange,
  snapToGrid,
  applyForcedMovement,
  directionFromTo,
  getGrappleDragSpeedMultiplier,
  type MovementAttempt,
  type Position,
} from "./movement.js";

describe("Movement and Positioning", () => {
  describe("calculateDistance", () => {
    it("should calculate distance between two positions", () => {
      const from: Position = { x: 0, y: 0 };
      const to: Position = { x: 30, y: 40 };

      const distance = calculateDistance(from, to);
      expect(distance).toBe(50); // 3-4-5 triangle
    });

    it("should handle same position", () => {
      const pos: Position = { x: 10, y: 10 };
      expect(calculateDistance(pos, pos)).toBe(0);
    });

    it("should handle diagonal movement", () => {
      const from: Position = { x: 0, y: 0 };
      const to: Position = { x: 5, y: 5 };

      const distance = calculateDistance(from, to);
      expect(distance).toBeCloseTo(7.07, 1); // sqrt(50) ≈ 7.07
    });
  });

  describe("calculateManhattanDistance", () => {
    it("should calculate grid-based distance", () => {
      const from: Position = { x: 0, y: 0 };
      const to: Position = { x: 15, y: 10 };

      const distance = calculateManhattanDistance(from, to);
      expect(distance).toBe(25); // 15 + 10
    });

    it("should handle diagonal as sum of axes", () => {
      const from: Position = { x: 5, y: 5 };
      const to: Position = { x: 10, y: 10 };

      const distance = calculateManhattanDistance(from, to);
      expect(distance).toBe(10); // 5 + 5
    });
  });

  describe("attemptMovement", () => {
    it("should succeed when distance is within speed", () => {
      const attempt: MovementAttempt = {
        from: { x: 0, y: 0 },
        to: { x: 20, y: 0 },
        speed: 30,
      };

      const result = attemptMovement(attempt);

      expect(result.success).toBe(true);
      expect(result.actualPosition).toEqual({ x: 20, y: 0 });
      expect(result.distanceMoved).toBe(20);
      expect(result.speedRemaining).toBe(10);
    });

    it("should fail when distance exceeds speed", () => {
      const attempt: MovementAttempt = {
        from: { x: 0, y: 0 },
        to: { x: 40, y: 0 },
        speed: 30,
      };

      const result = attemptMovement(attempt);

      expect(result.success).toBe(false);
      expect(result.actualPosition).toEqual({ x: 0, y: 0 });
      expect(result.reason).toContain("exceeds available speed");
    });

    it("should double speed when dashing", () => {
      const attempt: MovementAttempt = {
        from: { x: 0, y: 0 },
        to: { x: 50, y: 0 },
        speed: 30,
        isDashing: true,
      };

      const result = attemptMovement(attempt);

      expect(result.success).toBe(true); // 60ft available
      expect(result.distanceMoved).toBe(50);
      expect(result.speedRemaining).toBe(10);
    });

    it("should apply speed modifier for difficult terrain", () => {
      const attempt: MovementAttempt = {
        from: { x: 0, y: 0 },
        to: { x: 20, y: 0 },
        speed: 30,
        speedModifier: 0.5, // Difficult terrain
      };

      const result = attemptMovement(attempt);

      expect(result.success).toBe(false); // Only 15ft available (30 * 0.5)
    });

    it("should combine dash and difficult terrain", () => {
      const attempt: MovementAttempt = {
        from: { x: 0, y: 0 },
        to: { x: 25, y: 0 },
        speed: 30,
        isDashing: true,
        speedModifier: 0.5,
      };

      const result = attemptMovement(attempt);

      expect(result.success).toBe(true); // 30ft available (30 * 2 * 0.5)
      expect(result.speedRemaining).toBe(5);
    });
  });

  describe("isWithinRange", () => {
    it("should return true when within range", () => {
      const from: Position = { x: 0, y: 0 };
      const to: Position = { x: 3, y: 4 };

      expect(isWithinRange(from, to, 5)).toBe(true); // 5ft exactly
      expect(isWithinRange(from, to, 10)).toBe(true);
    });

    it("should return false when out of range", () => {
      const from: Position = { x: 0, y: 0 };
      const to: Position = { x: 30, y: 40 };

      expect(isWithinRange(from, to, 40)).toBe(false); // 50ft away
    });
  });

  describe("isWithinMeleeReach", () => {
    it("should check standard 5ft reach", () => {
      const from: Position = { x: 0, y: 0 };
      const nearby: Position = { x: 3, y: 4 };
      const far: Position = { x: 10, y: 0 };

      expect(isWithinMeleeReach(from, nearby)).toBe(true);
      expect(isWithinMeleeReach(from, far)).toBe(false);
    });

    it("should support custom reach for polearms", () => {
      const from: Position = { x: 0, y: 0 };
      const target: Position = { x: 8, y: 6 };

      expect(isWithinMeleeReach(from, target, 10)).toBe(true); // 10ft reach
      expect(isWithinMeleeReach(from, target, 5)).toBe(false);  // 5ft reach
    });
  });

  describe("crossesThroughReach", () => {
    it("should detect leaving reach", () => {
      const path = {
        from: { x: 0, y: 0 },  // Within 5ft of blocker
        to: { x: 20, y: 0 },   // Outside 5ft of blocker
      };
      const blocker: Position = { x: 3, y: 0 };

      const crosses = crossesThroughReach(path, blocker, 5);
      expect(crosses).toBe(true);
    });

    it("should not trigger when staying within reach", () => {
      const path = {
        from: { x: 0, y: 0 },
        to: { x: 3, y: 0 },
      };
      const blocker: Position = { x: 5, y: 0 };

      const crosses = crossesThroughReach(path, blocker, 5);
      expect(crosses).toBe(false);
    });

    it("should not trigger when outside reach entirely", () => {
      const path = {
        from: { x: 20, y: 0 },
        to: { x: 30, y: 0 },
      };
      const blocker: Position = { x: 0, y: 0 };

      const crosses = crossesThroughReach(path, blocker, 5);
      expect(crosses).toBe(false);
    });
  });

  describe("snapToGrid", () => {
    it("should snap to nearest 5ft grid", () => {
      expect(snapToGrid({ x: 7, y: 12 })).toEqual({ x: 5, y: 10 });
      expect(snapToGrid({ x: 13, y: 18 })).toEqual({ x: 15, y: 20 });
      expect(snapToGrid({ x: 22, y: 3 })).toEqual({ x: 20, y: 5 });
    });

    it("should handle positions already on grid", () => {
      expect(snapToGrid({ x: 15, y: 20 })).toEqual({ x: 15, y: 20 });
    });

    it("should support custom grid sizes", () => {
      expect(snapToGrid({ x: 7, y: 12 }, 10)).toEqual({ x: 10, y: 10 });
    });
  });

  describe("getPositionsInRadius", () => {
    it("should get positions within radius", () => {
      const center: Position = { x: 0, y: 0 };
      const positions = getPositionsInRadius(center, 10);

      // Should include center
      expect(positions).toContainEqual({ x: 0, y: 0 });

      // All positions should be within 10ft
      positions.forEach(pos => {
        expect(calculateDistance(center, pos)).toBeLessThanOrEqual(10);
      });
    });

    it("should return only center for very small radius", () => {
      const center: Position = { x: 10, y: 10 };
      const positions = getPositionsInRadius(center, 2);

      expect(positions.length).toBeGreaterThanOrEqual(1);
      expect(positions).toContainEqual({ x: 10, y: 10 });
    });
  });

  // ——————————————————————————————————————————————
  // Jump mechanics (D&D 5e 2024)
  // ——————————————————————————————————————————————

  describe("calculateLongJumpDistance", () => {
    it("should equal Strength score with running start", () => {
      // STR 16 → 16ft long jump
      const result = calculateLongJumpDistance(16, true);
      expect(result.maxDistanceFeet).toBe(16);
      expect(result.movementCostFeet).toBe(16);
      expect(result.hadRunningStart).toBe(true);
      expect(result.jumpType).toBe("long");
    });

    it("should halve distance without running start (standing jump)", () => {
      // STR 16, standing → 8ft
      const result = calculateLongJumpDistance(16, false);
      expect(result.maxDistanceFeet).toBe(8);
      expect(result.movementCostFeet).toBe(8);
      expect(result.hadRunningStart).toBe(false);
    });

    it("should apply multiplier (Step of the Wind doubles)", () => {
      // STR 14, running start, ×2 → 28ft
      const result = calculateLongJumpDistance(14, true, 2);
      expect(result.maxDistanceFeet).toBe(28);
      expect(result.movementCostFeet).toBe(28);
    });

    it("should apply multiplier to standing jump", () => {
      // STR 14, standing, ×2 → floor(28/2) = 14ft
      const result = calculateLongJumpDistance(14, false, 2);
      expect(result.maxDistanceFeet).toBe(14);
    });

    it("should floor odd values for standing jump", () => {
      // STR 15, standing → floor(15/2) = 7ft
      const result = calculateLongJumpDistance(15, false);
      expect(result.maxDistanceFeet).toBe(7);
    });

    it("should handle STR 10 (average)", () => {
      const result = calculateLongJumpDistance(10, true);
      expect(result.maxDistanceFeet).toBe(10);
    });

    it("should handle very low STR (minimum 0ft)", () => {
      const result = calculateLongJumpDistance(-1, true);
      expect(result.maxDistanceFeet).toBe(0);
    });
  });

  describe("calculateHighJumpDistance", () => {
    it("should equal 3 + STR modifier with running start", () => {
      // STR mod +3 → 6ft high jump
      const result = calculateHighJumpDistance(3, true);
      expect(result.maxDistanceFeet).toBe(6);
      expect(result.movementCostFeet).toBe(6);
      expect(result.hadRunningStart).toBe(true);
      expect(result.jumpType).toBe("high");
    });

    it("should halve distance without running start", () => {
      // STR mod +3, standing → floor(6/2) = 3ft
      const result = calculateHighJumpDistance(3, false);
      expect(result.maxDistanceFeet).toBe(3);
      expect(result.hadRunningStart).toBe(false);
    });

    it("should apply multiplier (Step of the Wind)", () => {
      // STR mod +2, running, ×2 → (3+2)*2 = 10ft
      const result = calculateHighJumpDistance(2, true, 2);
      expect(result.maxDistanceFeet).toBe(10);
    });

    it("should have minimum 0ft for negative modifiers", () => {
      // STR mod -4 → max(0, 3 + (-4)) = max(0, -1) = 0
      const result = calculateHighJumpDistance(-4, true);
      expect(result.maxDistanceFeet).toBe(0);
    });

    it("should handle STR mod 0 (average)", () => {
      // 3 + 0 = 3ft
      const result = calculateHighJumpDistance(0, true);
      expect(result.maxDistanceFeet).toBe(3);
    });

    it("should floor standing jump with odd base", () => {
      // STR mod +2 → base 5, standing → floor(5/2) = 2ft
      const result = calculateHighJumpDistance(2, false);
      expect(result.maxDistanceFeet).toBe(2);
    });
  });

  describe("computeJumpLandingPosition", () => {
    it("should move along positive X axis by default (no direction target)", () => {
      const origin: Position = { x: 10, y: 10 };
      const result = computeJumpLandingPosition(origin, 15, "long");
      expect(result).toEqual({ x: 25, y: 10 });
    });

    it("should move toward a direction target", () => {
      const origin: Position = { x: 0, y: 0 };
      const target: Position = { x: 50, y: 0 };
      const result = computeJumpLandingPosition(origin, 16, "long", target);
      expect(result).toEqual({ x: 15, y: 0 }); // snapped to grid
    });

    it("should move diagonally toward target and snap to grid", () => {
      const origin: Position = { x: 0, y: 0 };
      const target: Position = { x: 50, y: 50 }; // 45-degree angle
      const result = computeJumpLandingPosition(origin, 10, "long", target);
      // 10ft at 45° ≈ (7.07, 7.07) → snapped to (5, 5) or (10, 10) depending on rounding
      // 7.07 / 5 = 1.414 → Math.round → 1 → 5
      expect(result).toEqual({ x: 5, y: 5 });
    });

    it("should not move horizontally for high jump", () => {
      const origin: Position = { x: 10, y: 10 };
      const target: Position = { x: 50, y: 10 };
      const result = computeJumpLandingPosition(origin, 5, "high", target);
      expect(result).toEqual({ x: 10, y: 10 }); // same position — high jump is vertical
    });

    it("should return origin for 0 distance", () => {
      const origin: Position = { x: 20, y: 20 };
      const result = computeJumpLandingPosition(origin, 0, "long", { x: 50, y: 20 });
      expect(result).toEqual({ x: 20, y: 20 });
    });

    it("should default to positive X when direction target equals origin", () => {
      const origin: Position = { x: 10, y: 10 };
      const result = computeJumpLandingPosition(origin, 10, "long", { x: 10, y: 10 });
      expect(result).toEqual({ x: 20, y: 10 }); // default X axis
    });

    it("should jump along negative X axis", () => {
      const origin: Position = { x: 30, y: 10 };
      const target: Position = { x: 0, y: 10 };
      const result = computeJumpLandingPosition(origin, 16, "long", target);
      expect(result).toEqual({ x: 15, y: 10 });
    });

    it("should jump along Y axis", () => {
      const origin: Position = { x: 10, y: 0 };
      const target: Position = { x: 10, y: 50 };
      const result = computeJumpLandingPosition(origin, 20, "long", target);
      expect(result).toEqual({ x: 10, y: 20 });
    });
  });

  describe("applyForcedMovement", () => {
    it("should push creature 10ft in a direction", () => {
      const origin: Position = { x: 20, y: 20 };
      const direction = { x: 1, y: 0 }; // push east
      const result = applyForcedMovement(origin, direction, 10);
      expect(result.finalPosition).toEqual({ x: 30, y: 20 });
      expect(result.distanceMoved).toBe(10);
      expect(result.blocked).toBe(false);
    });

    it("should push creature 15ft (Open Hand Technique)", () => {
      const origin: Position = { x: 10, y: 10 };
      const direction = { x: 0, y: 1 }; // push south
      const result = applyForcedMovement(origin, direction, 15);
      expect(result.finalPosition).toEqual({ x: 10, y: 25 });
      expect(result.distanceMoved).toBe(15);
      expect(result.blocked).toBe(false);
    });

    it("should stop at map edge", () => {
      const origin: Position = { x: 90, y: 50 };
      const direction = { x: 1, y: 0 }; // push east
      const map = {
        width: 100,
        height: 100,
        gridSize: 5,
        cells: Array.from({ length: 21 * 21 }, (_, i) => ({
          position: { x: (i % 21) * 5, y: Math.floor(i / 21) * 5 },
          passable: true,
        })),
      };
      const result = applyForcedMovement(origin, direction, 20, map);
      expect(result.finalPosition.x).toBeLessThanOrEqual(100);
      expect(result.blocked).toBe(true);
      expect(result.distanceMoved).toBeLessThan(20);
    });

    it("should stop at wall/obstacle", () => {
      const origin: Position = { x: 20, y: 20 };
      const direction = { x: 1, y: 0 }; // push east
      // Create a simple map with a wall at x=30
      const cells = [];
      for (let x = 0; x <= 50; x += 5) {
        for (let y = 0; y <= 50; y += 5) {
          cells.push({
            position: { x, y },
            passable: x !== 30 || y !== 20 ? true : false, // wall at (30, 20)
          });
        }
      }
      const map = { width: 50, height: 50, gridSize: 5, cells };
      const result = applyForcedMovement(origin, direction, 15, map);
      expect(result.finalPosition).toEqual({ x: 25, y: 20 });
      expect(result.blocked).toBe(true);
      expect(result.distanceMoved).toBe(5);
    });

    it("should return zero movement for zero distance", () => {
      const origin: Position = { x: 20, y: 20 };
      const result = applyForcedMovement(origin, { x: 1, y: 0 }, 0);
      expect(result.finalPosition).toEqual(origin);
      expect(result.distanceMoved).toBe(0);
      expect(result.blocked).toBe(false);
    });

    it("should return zero movement for zero direction vector", () => {
      const origin: Position = { x: 20, y: 20 };
      const result = applyForcedMovement(origin, { x: 0, y: 0 }, 10);
      expect(result.finalPosition).toEqual(origin);
      expect(result.distanceMoved).toBe(0);
      expect(result.blocked).toBe(false);
    });

    it("should handle diagonal push", () => {
      const origin: Position = { x: 20, y: 20 };
      const direction = { x: 1, y: 1 }; // push diagonally
      const result = applyForcedMovement(origin, direction, 10);
      // Should snap to grid — moved roughly 10ft diagonally
      expect(result.distanceMoved).toBeGreaterThan(0);
      expect(result.blocked).toBe(false);
    });
  });

  describe("directionFromTo", () => {
    it("should compute direction from source to target", () => {
      const from: Position = { x: 10, y: 10 };
      const to: Position = { x: 30, y: 10 };
      const dir = directionFromTo(from, to);
      expect(dir.x).toBe(20);
      expect(dir.y).toBe(0);
    });
  });

  describe("getGrappleDragSpeedMultiplier", () => {
    it("should return 0.5 for same-size creatures", () => {
      expect(getGrappleDragSpeedMultiplier("Medium", "Medium")).toBe(0.5);
    });

    it("should return 0.5 for one-size-smaller creature", () => {
      expect(getGrappleDragSpeedMultiplier("Large", "Medium")).toBe(0.5);
    });

    it("should return 1.0 for Tiny creature (always free)", () => {
      expect(getGrappleDragSpeedMultiplier("Medium", "Tiny")).toBe(1.0);
      expect(getGrappleDragSpeedMultiplier("Large", "Tiny")).toBe(1.0);
    });

    it("should return 1.0 when grappled is 2+ sizes smaller", () => {
      expect(getGrappleDragSpeedMultiplier("Large", "Small")).toBe(1.0);
      expect(getGrappleDragSpeedMultiplier("Huge", "Medium")).toBe(1.0);
      expect(getGrappleDragSpeedMultiplier("Gargantuan", "Medium")).toBe(1.0);
    });

    it("should return 0.5 when dragging larger creature", () => {
      expect(getGrappleDragSpeedMultiplier("Small", "Medium")).toBe(0.5);
    });
  });
});
