import { describe, expect, it } from "vitest";

import { AbilityScores } from "../entities/core/ability-scores.js";
import { NPC } from "../entities/creatures/npc.js";
import { DamageEffect } from "./damage-effect.js";
import { HealingEffect } from "./healing-effect.js";
import { ConditionEffect } from "./condition-effect.js";
import { applyResourceCost } from "./resource-cost.js";

function makeTarget(hp = 10, opts?: { damageResistances?: string[]; damageImmunities?: string[]; damageVulnerabilities?: string[] }) {
  return new NPC({
    id: "t1",
    name: "Target",
    maxHP: hp,
    currentHP: hp,
    armorClass: 12,
    speed: 30,
    abilityScores: new AbilityScores({
      strength: 10,
      dexterity: 10,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
    }),
    proficiencyBonus: 2,
    ...opts,
  });
}

describe("Effects", () => {
  it("applies damage, healing, and conditions deterministically", () => {
    const npc = makeTarget();

    new DamageEffect({ amount: 3 }).apply(npc);
    expect(npc.getCurrentHP()).toBe(7);

    new HealingEffect({ amount: 2 }).apply(npc);
    expect(npc.getCurrentHP()).toBe(9);

    new ConditionEffect({ condition: "Prone" }).apply(npc);
    expect(npc.hasCondition("prone")).toBe(true);
  });

  it("applies resource costs using ResourcePool", () => {
    const pools = [
      { name: "spellSlots1", current: 2, max: 4 },
      { name: "ki", current: 1, max: 1 },
    ];

    const next = applyResourceCost(pools, { poolName: "spellSlots1", amount: 1 });
    expect(next[0]!.current).toBe(1);
    expect(next[1]!.current).toBe(1);
  });

  describe("DamageEffect damage defenses", () => {
    it("applies damage resistance when damage type matches", () => {
      const npc = makeTarget(20, { damageResistances: ["fire"] });
      const result = new DamageEffect({ amount: 10, damageType: "fire" }).apply(npc);

      expect(result.applied).toBe(5); // 10 / 2 = 5
      expect(result.defenseApplied).toBe("resistance");
      expect(npc.getCurrentHP()).toBe(15);
    });

    it("applies damage immunity when damage type matches", () => {
      const npc = makeTarget(20, { damageImmunities: ["poison"] });
      const result = new DamageEffect({ amount: 8, damageType: "poison" }).apply(npc);

      expect(result.applied).toBe(0);
      expect(result.defenseApplied).toBe("immunity");
      expect(npc.getCurrentHP()).toBe(20);
    });

    it("applies damage vulnerability when damage type matches", () => {
      const npc = makeTarget(40, { damageVulnerabilities: ["radiant"] });
      const result = new DamageEffect({ amount: 6, damageType: "radiant" }).apply(npc);

      expect(result.applied).toBe(12); // 6 * 2 = 12
      expect(result.defenseApplied).toBe("vulnerability");
      expect(npc.getCurrentHP()).toBe(28);
    });

    it("applies full damage when no defenses match", () => {
      const npc = makeTarget(20, { damageResistances: ["cold"] });
      const result = new DamageEffect({ amount: 7, damageType: "fire" }).apply(npc);

      expect(result.applied).toBe(7);
      expect(result.defenseApplied).toBe("none");
      expect(npc.getCurrentHP()).toBe(13);
    });

    it("applies full damage when no damage type specified (untyped)", () => {
      const npc = makeTarget(20, { damageResistances: ["fire"] });
      const result = new DamageEffect({ amount: 7 }).apply(npc);

      expect(result.applied).toBe(7);
      expect(result.defenseApplied).toBeUndefined();
      expect(npc.getCurrentHP()).toBe(13);
    });
  });
});
