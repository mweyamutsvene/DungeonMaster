import { describe, it, expect } from "vitest";
import {
  applyDamageDefenses,
  extractDamageDefenses,
  type DamageDefenses,
} from "./damage-defenses.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defenses(overrides: Partial<DamageDefenses> = {}): DamageDefenses {
  return {
    damageResistances: [],
    damageImmunities: [],
    damageVulnerabilities: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// applyDamageDefenses — resistance
// ---------------------------------------------------------------------------

describe("applyDamageDefenses — resistance", () => {
  it("halves damage (rounded down) when resistant", () => {
    const result = applyDamageDefenses(10, "fire", defenses({ damageResistances: ["fire"] }));
    expect(result.adjustedDamage).toBe(5);
    expect(result.defenseApplied).toBe("resistance");
    expect(result.originalDamage).toBe(10);
  });

  it("rounds down odd damage", () => {
    const result = applyDamageDefenses(7, "cold", defenses({ damageResistances: ["cold"] }));
    expect(result.adjustedDamage).toBe(3); // floor(7/2)
  });

  it("is case-insensitive", () => {
    const result = applyDamageDefenses(10, "Fire", defenses({ damageResistances: ["FIRE"] }));
    expect(result.adjustedDamage).toBe(5);
    expect(result.defenseApplied).toBe("resistance");
  });

  it("does not apply when damage type doesn't match", () => {
    const result = applyDamageDefenses(10, "fire", defenses({ damageResistances: ["cold"] }));
    expect(result.adjustedDamage).toBe(10);
    expect(result.defenseApplied).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// applyDamageDefenses — vulnerability
// ---------------------------------------------------------------------------

describe("applyDamageDefenses — vulnerability", () => {
  it("doubles damage when vulnerable", () => {
    const result = applyDamageDefenses(
      10,
      "fire",
      defenses({ damageVulnerabilities: ["fire"] }),
    );
    expect(result.adjustedDamage).toBe(20);
    expect(result.defenseApplied).toBe("vulnerability");
    expect(result.originalDamage).toBe(10);
  });

  it("is case-insensitive", () => {
    const result = applyDamageDefenses(
      6,
      "COLD",
      defenses({ damageVulnerabilities: ["cold"] }),
    );
    expect(result.adjustedDamage).toBe(12);
    expect(result.defenseApplied).toBe("vulnerability");
  });
});

// ---------------------------------------------------------------------------
// applyDamageDefenses — immunity
// ---------------------------------------------------------------------------

describe("applyDamageDefenses — immunity", () => {
  it("zeroes damage when immune", () => {
    const result = applyDamageDefenses(
      25,
      "poison",
      defenses({ damageImmunities: ["poison"] }),
    );
    expect(result.adjustedDamage).toBe(0);
    expect(result.defenseApplied).toBe("immunity");
    expect(result.originalDamage).toBe(25);
  });

  it("immunity takes priority over resistance", () => {
    const result = applyDamageDefenses(
      10,
      "fire",
      defenses({ damageImmunities: ["fire"], damageResistances: ["fire"] }),
    );
    expect(result.adjustedDamage).toBe(0);
    expect(result.defenseApplied).toBe("immunity");
  });

  it("immunity takes priority over vulnerability", () => {
    const result = applyDamageDefenses(
      10,
      "fire",
      defenses({ damageImmunities: ["fire"], damageVulnerabilities: ["fire"] }),
    );
    expect(result.adjustedDamage).toBe(0);
    expect(result.defenseApplied).toBe("immunity");
  });
});

// ---------------------------------------------------------------------------
// applyDamageDefenses — resistance + vulnerability cancel
// ---------------------------------------------------------------------------

describe("applyDamageDefenses — resistance + vulnerability cancel", () => {
  it("returns normal damage when both resistance and vulnerability apply", () => {
    const result = applyDamageDefenses(
      10,
      "fire",
      defenses({ damageResistances: ["fire"], damageVulnerabilities: ["fire"] }),
    );
    expect(result.adjustedDamage).toBe(10);
    expect(result.defenseApplied).toBe("none");
  });
});

// ---------------------------------------------------------------------------
// applyDamageDefenses — edge cases
// ---------------------------------------------------------------------------

describe("applyDamageDefenses — edge cases", () => {
  it("returns 0 adjusted damage for 0 input damage", () => {
    const result = applyDamageDefenses(
      0,
      "fire",
      defenses({ damageVulnerabilities: ["fire"] }),
    );
    expect(result.adjustedDamage).toBe(0);
    expect(result.defenseApplied).toBe("none");
  });

  it("returns negative damage unchanged (no defenses apply)", () => {
    const result = applyDamageDefenses(
      -5,
      "fire",
      defenses({ damageVulnerabilities: ["fire"] }),
    );
    expect(result.adjustedDamage).toBe(-5);
    expect(result.defenseApplied).toBe("none");
  });

  it("returns damage unchanged when damageType is undefined", () => {
    const result = applyDamageDefenses(
      10,
      undefined,
      defenses({ damageResistances: ["fire"] }),
    );
    expect(result.adjustedDamage).toBe(10);
    expect(result.defenseApplied).toBe("none");
  });

  it("returns damage unchanged when damageType is empty string", () => {
    const result = applyDamageDefenses(10, "", defenses({ damageResistances: ["fire"] }));
    expect(result.adjustedDamage).toBe(10);
    expect(result.defenseApplied).toBe("none");
  });

  it("handles empty defense arrays", () => {
    const result = applyDamageDefenses(10, "fire", defenses());
    expect(result.adjustedDamage).toBe(10);
    expect(result.defenseApplied).toBe("none");
  });

  it("handles undefined defense arrays", () => {
    const result = applyDamageDefenses(10, "fire", {});
    expect(result.adjustedDamage).toBe(10);
    expect(result.defenseApplied).toBe("none");
  });

  it("trims whitespace in damage type and defense strings", () => {
    const result = applyDamageDefenses(
      10,
      "  fire  ",
      defenses({ damageResistances: ["  fire  "] }),
    );
    expect(result.adjustedDamage).toBe(5);
    expect(result.defenseApplied).toBe("resistance");
  });

  it("resistance on 1 damage yields 0 (floor(1/2) = 0)", () => {
    const result = applyDamageDefenses(1, "fire", defenses({ damageResistances: ["fire"] }));
    expect(result.adjustedDamage).toBe(0);
    expect(result.defenseApplied).toBe("resistance");
  });
});

// ---------------------------------------------------------------------------
// extractDamageDefenses
// ---------------------------------------------------------------------------

describe("extractDamageDefenses", () => {
  it("extracts all three defense arrays from an object", () => {
    const data = {
      damageResistances: ["fire", "cold"],
      damageImmunities: ["poison"],
      damageVulnerabilities: ["radiant"],
    };
    const result = extractDamageDefenses(data);
    expect(result.damageResistances).toEqual(["fire", "cold"]);
    expect(result.damageImmunities).toEqual(["poison"]);
    expect(result.damageVulnerabilities).toEqual(["radiant"]);
  });

  it("returns empty object for null input", () => {
    expect(extractDamageDefenses(null)).toEqual({});
  });

  it("returns empty object for undefined input", () => {
    expect(extractDamageDefenses(undefined)).toEqual({});
  });

  it("returns empty object for non-object input", () => {
    expect(extractDamageDefenses("string")).toEqual({});
    expect(extractDamageDefenses(42)).toEqual({});
  });

  it("returns undefined arrays when fields are missing", () => {
    const result = extractDamageDefenses({});
    expect(result.damageResistances).toBeUndefined();
    expect(result.damageImmunities).toBeUndefined();
    expect(result.damageVulnerabilities).toBeUndefined();
  });

  it("filters non-string array elements", () => {
    const data = {
      damageResistances: ["fire", 123, null, "cold"],
    };
    const result = extractDamageDefenses(data);
    expect(result.damageResistances).toEqual(["fire", "cold"]);
  });

  it("returns undefined for non-array field values", () => {
    const data = {
      damageResistances: "fire",
      damageImmunities: 42,
    };
    const result = extractDamageDefenses(data);
    expect(result.damageResistances).toBeUndefined();
    expect(result.damageImmunities).toBeUndefined();
  });
});
