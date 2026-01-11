import { describe, expect, it } from "vitest";
import {
  attemptMovement,
  calculateDistance,
  calculateManhattanDistance,
  crossesThroughReach,
  getPositionsInRadius,
  isWithinMeleeReach,
  isWithinRange,
  snapToGrid,
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
});
