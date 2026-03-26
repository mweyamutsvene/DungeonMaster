import { describe, it, expect } from "vitest";
import {
  getLegendaryActionsRemaining,
  getLegendaryActionCharges,
  spendLegendaryAction,
  resetLegendaryActions,
  isLegendaryCreature,
  getLegendaryActionDefs,
} from "./resource-utils.js";
import type { JsonValue } from "../../../types.js";

describe("Legendary Action Resource Helpers", () => {
  const baseLegendaryResources: JsonValue = {
    legendaryActionCharges: 3,
    legendaryActionsRemaining: 3,
    legendaryActions: [
      { name: "Tail Attack", cost: 1, description: "Tail sweep", actionType: "attack", attackName: "Tail" },
      { name: "Wing Attack", cost: 2, description: "Wing buffet", actionType: "special" },
      { name: "Move", cost: 1, description: "Move half speed", actionType: "move" },
    ],
  };

  describe("getLegendaryActionsRemaining", () => {
    it("returns remaining charges", () => {
      expect(getLegendaryActionsRemaining(baseLegendaryResources)).toBe(3);
    });

    it("returns 0 for non-legendary creature", () => {
      expect(getLegendaryActionsRemaining({})).toBe(0);
    });

    it("returns 0 for null resources", () => {
      expect(getLegendaryActionsRemaining(null)).toBe(0);
    });
  });

  describe("getLegendaryActionCharges", () => {
    it("returns max charges", () => {
      expect(getLegendaryActionCharges(baseLegendaryResources)).toBe(3);
    });

    it("returns 0 for non-legendary creature", () => {
      expect(getLegendaryActionCharges({})).toBe(0);
    });
  });

  describe("isLegendaryCreature", () => {
    it("returns true for legendary creature", () => {
      expect(isLegendaryCreature(baseLegendaryResources)).toBe(true);
    });

    it("returns false for non-legendary creature", () => {
      expect(isLegendaryCreature({})).toBe(false);
    });

    it("returns false for null resources", () => {
      expect(isLegendaryCreature(null)).toBe(false);
    });
  });

  describe("spendLegendaryAction", () => {
    it("deducts the correct cost", () => {
      const result = spendLegendaryAction(baseLegendaryResources, 1);
      expect(getLegendaryActionsRemaining(result)).toBe(2);
    });

    it("deducts a 2-charge cost", () => {
      const result = spendLegendaryAction(baseLegendaryResources, 2);
      expect(getLegendaryActionsRemaining(result)).toBe(1);
    });

    it("throws when insufficient charges", () => {
      const spent = spendLegendaryAction(
        spendLegendaryAction(baseLegendaryResources, 2),
        1,
      );
      // Now at 0 charges
      expect(getLegendaryActionsRemaining(spent)).toBe(0);
      expect(() => spendLegendaryAction(spent, 1)).toThrow("Insufficient legendary action charges");
    });

    it("can spend all 3 charges", () => {
      let res = baseLegendaryResources;
      res = spendLegendaryAction(res, 1);
      res = spendLegendaryAction(res, 1);
      res = spendLegendaryAction(res, 1);
      expect(getLegendaryActionsRemaining(res)).toBe(0);
    });
  });

  describe("resetLegendaryActions", () => {
    it("resets charges to max", () => {
      let res = spendLegendaryAction(baseLegendaryResources, 2);
      expect(getLegendaryActionsRemaining(res)).toBe(1);
      res = resetLegendaryActions(res);
      expect(getLegendaryActionsRemaining(res)).toBe(3);
    });

    it("no-ops for non-legendary creature", () => {
      const res = {};
      const result = resetLegendaryActions(res);
      expect(result).toBe(res); // Same reference — nothing changed
    });
  });

  describe("getLegendaryActionDefs", () => {
    it("returns defined legendary actions", () => {
      const defs = getLegendaryActionDefs(baseLegendaryResources);
      expect(defs).toHaveLength(3);
      expect(defs[0].name).toBe("Tail Attack");
      expect(defs[0].cost).toBe(1);
      expect(defs[0].actionType).toBe("attack");
      expect(defs[0].attackName).toBe("Tail");
      expect(defs[1].name).toBe("Wing Attack");
      expect(defs[1].cost).toBe(2);
      expect(defs[2].actionType).toBe("move");
    });

    it("returns empty array for non-legendary creature", () => {
      expect(getLegendaryActionDefs({})).toEqual([]);
    });
  });
});
