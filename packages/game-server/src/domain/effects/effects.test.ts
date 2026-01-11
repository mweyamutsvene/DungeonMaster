import { describe, expect, it } from "vitest";

import { AbilityScores } from "../entities/core/ability-scores.js";
import { NPC } from "../entities/creatures/npc.js";
import { DamageEffect } from "./damage-effect.js";
import { HealingEffect } from "./healing-effect.js";
import { ConditionEffect } from "./condition-effect.js";
import { applyResourceCost } from "./resource-cost.js";

describe("Effects", () => {
  it("applies damage, healing, and conditions deterministically", () => {
    const npc = new NPC({
      id: "t1",
      name: "Target",
      maxHP: 10,
      currentHP: 10,
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
    });

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
});
