import { describe, it, expect } from "vitest";
import { parseLegendaryTraits } from "./legendary-actions.js";

describe("parseLegendaryTraits", () => {
  it("parses a stat block with legendary actions", () => {
    const statBlock = {
      legendaryActionCharges: 3,
      legendaryActions: [
        { name: "Tail Attack", cost: 1, description: "Tail sweep", actionType: "attack", attackName: "Tail" },
        { name: "Wing Attack", cost: 2, description: "Wing buffet", actionType: "special" },
      ],
    };

    const result = parseLegendaryTraits(statBlock);
    expect(result).toBeDefined();
    expect(result!.legendaryActionCharges).toBe(3);
    expect(result!.legendaryActions).toHaveLength(2);
    expect(result!.legendaryActions[0].name).toBe("Tail Attack");
    expect(result!.legendaryActions[0].cost).toBe(1);
    expect(result!.legendaryActions[0].actionType).toBe("attack");
    expect(result!.legendaryActions[0].attackName).toBe("Tail");
    expect(result!.legendaryActions[1].name).toBe("Wing Attack");
    expect(result!.legendaryActions[1].cost).toBe(2);
  });

  it("defaults charges to 3 when not specified", () => {
    const statBlock = {
      legendaryActions: [
        { name: "Attack", cost: 1, description: "Basic attack", actionType: "attack" },
      ],
    };
    const result = parseLegendaryTraits(statBlock);
    expect(result!.legendaryActionCharges).toBe(3);
  });

  it("defaults cost to 1 when not specified", () => {
    const statBlock = {
      legendaryActions: [
        { name: "Attack", description: "Basic attack", actionType: "attack" },
      ],
    };
    const result = parseLegendaryTraits(statBlock);
    expect(result!.legendaryActions[0].cost).toBe(1);
  });

  it("defaults actionType to 'special' when not valid", () => {
    const statBlock = {
      legendaryActions: [
        { name: "Weird Ability", cost: 1, description: "Does stuff" },
      ],
    };
    const result = parseLegendaryTraits(statBlock);
    expect(result!.legendaryActions[0].actionType).toBe("special");
  });

  it("returns undefined for stat block without legendary actions", () => {
    expect(parseLegendaryTraits({})).toBeUndefined();
    expect(parseLegendaryTraits({ legendaryActions: [] })).toBeUndefined();
  });

  it("parses lair actions", () => {
    const statBlock = {
      legendaryActions: [
        { name: "Attack", cost: 1, description: "Basic attack", actionType: "attack" },
      ],
      lairActions: [
        { name: "Tremor", description: "The ground shakes", saveDC: 15, saveAbility: "dexterity", damage: "2d6", damageType: "bludgeoning" },
        { name: "Darkness", description: "Darkness fills the area", effect: "Magical darkness" },
      ],
      isInLair: true,
    };

    const result = parseLegendaryTraits(statBlock);
    expect(result).toBeDefined();
    expect(result!.lairActions).toHaveLength(2);
    expect(result!.lairActions![0].name).toBe("Tremor");
    expect(result!.lairActions![0].saveDC).toBe(15);
    expect(result!.lairActions![0].damage).toBe("2d6");
    expect(result!.lairActions![1].effect).toBe("Magical darkness");
    expect(result!.isInLair).toBe(true);
  });

  it("omits lairActions when not present", () => {
    const statBlock = {
      legendaryActions: [
        { name: "Attack", cost: 1, description: "Basic attack", actionType: "attack" },
      ],
    };
    const result = parseLegendaryTraits(statBlock);
    expect(result!.lairActions).toBeUndefined();
    expect(result!.isInLair).toBeUndefined();
  });
});
