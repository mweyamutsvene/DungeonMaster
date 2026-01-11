import { describe, expect, it } from "vitest";

import { applyMovement, movementCost } from "./movement-rules.js";
import { freshActionEconomy } from "../entities/combat/action-economy.js";

describe("movement-rules", () => {
  it("difficult terrain doubles movement cost", () => {
    expect(movementCost(10, false)).toBe(10);
    expect(movementCost(10, true)).toBe(20);
  });

  it("applyMovement spends from action economy", () => {
    const econ = freshActionEconomy(30);
    applyMovement(econ, 10, true);
    expect(econ.movementRemainingFeet).toBe(10);
  });
});
