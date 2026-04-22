/**
 * Lock-in test for GAP-7: tabletop critical-hit threshold lookup.
 *
 * The `handleAttackRoll` path in roll-state-machine.ts computes:
 *   critThreshold = attackerChar ? getCriticalHitThreshold(classId, level, subclassId) : 20
 *   isCritical    = rollValue >= critThreshold
 *
 * These tests validate the contract that drives that line:
 *   - Champion Fighter L3+ gets Improved Critical (nat 19 = crit).
 *   - Non-Champion fighters and non-fighter classes at L3 keep threshold 20.
 *   - Monsters / actors without a class fall back to threshold 20.
 *   - A nat 20 is always a crit (non-regression).
 */

import { describe, expect, it } from "vitest";
import { getCriticalHitThreshold } from "../../../../domain/entities/classes/registry.js";

function isCritical(rollValue: number, classId: string | undefined, level: number | undefined, subclassId?: string): boolean {
  const critThreshold = classId && level ? getCriticalHitThreshold(classId, level, subclassId) : 20;
  return rollValue >= critThreshold;
}

describe("GAP-7: Improved Critical in tabletop roll resolution", () => {
  it("Champion Fighter L3 rolling nat 19 → critical hit", () => {
    expect(isCritical(19, "fighter", 3, "champion")).toBe(true);
  });

  it("Champion Fighter L3 rolling nat 18 → not a critical hit", () => {
    expect(isCritical(18, "fighter", 3, "champion")).toBe(false);
  });

  it("Non-Champion Fighter (no subclass) L3 rolling nat 19 → not a critical hit", () => {
    expect(isCritical(19, "fighter", 3)).toBe(false);
  });

  it("Battlemaster Fighter L3 rolling nat 19 → not a critical hit", () => {
    expect(isCritical(19, "fighter", 3, "battlemaster")).toBe(false);
  });

  it("Champion Fighter L3 rolling nat 20 → still a critical hit (non-regression)", () => {
    expect(isCritical(20, "fighter", 3, "champion")).toBe(true);
  });

  it("Champion Fighter L2 rolling nat 19 → not yet a critical hit (Improved Critical is L3+)", () => {
    expect(isCritical(19, "fighter", 2, "champion")).toBe(false);
  });

  it("Monster attacker (no classId) rolling nat 19 → not a critical hit", () => {
    expect(isCritical(19, undefined, undefined)).toBe(false);
  });

  it("Monster attacker (no classId) rolling nat 20 → critical hit", () => {
    expect(isCritical(20, undefined, undefined)).toBe(true);
  });

  it("Non-fighter class (wizard) L3 rolling nat 19 → not a critical hit", () => {
    expect(isCritical(19, "wizard", 3)).toBe(false);
  });
});
