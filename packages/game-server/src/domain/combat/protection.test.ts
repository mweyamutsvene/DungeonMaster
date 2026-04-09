import { describe, it, expect } from "vitest";
import { canUseProtection, type ProtectionEligibility } from "./protection.js";

describe("Protection Fighting Style", () => {
  const baseProtector: ProtectionEligibility = {
    hasProtectionStyle: true,
    hasReactionAvailable: true,
    isWieldingShield: true,
  };

  it("allows Protection when all conditions met and within 5ft", () => {
    expect(canUseProtection(baseProtector, { x: 10, y: 10 }, { x: 15, y: 10 })).toBe(true);
  });

  it("rejects when protector does not have Protection style", () => {
    const p = { ...baseProtector, hasProtectionStyle: false };
    expect(canUseProtection(p, { x: 10, y: 10 }, { x: 15, y: 10 })).toBe(false);
  });

  it("rejects when reaction is not available", () => {
    const p = { ...baseProtector, hasReactionAvailable: false };
    expect(canUseProtection(p, { x: 10, y: 10 }, { x: 15, y: 10 })).toBe(false);
  });

  it("rejects when not wielding a shield", () => {
    const p = { ...baseProtector, isWieldingShield: false };
    expect(canUseProtection(p, { x: 10, y: 10 }, { x: 15, y: 10 })).toBe(false);
  });

  it("rejects when protector is more than 5ft from target", () => {
    expect(canUseProtection(baseProtector, { x: 10, y: 10 }, { x: 25, y: 10 })).toBe(false);
  });

  it("rejects when positions are null", () => {
    expect(canUseProtection(baseProtector, null, { x: 15, y: 10 })).toBe(false);
    expect(canUseProtection(baseProtector, { x: 10, y: 10 }, null)).toBe(false);
  });
});
