import { describe, it, expect } from "vitest";
import { getCanonicalSpell } from "./index.js";
import { ARMOR_OF_AGATHYS } from "./level-1.js";

describe("Armor of Agathys catalog entry", () => {
  it("is registered and retrievable via getCanonicalSpell", () => {
    const spell = getCanonicalSpell("Armor of Agathys");
    expect(spell).not.toBeNull();
    expect(spell!.name).toBe("Armor of Agathys");
    expect(spell!.level).toBe(1);
  });

  it("is case-insensitive resolvable", () => {
    expect(getCanonicalSpell("armor of agathys")?.name).toBe("Armor of Agathys");
    expect(getCanonicalSpell("ARMOR OF AGATHYS")?.name).toBe("Armor of Agathys");
  });

  it("is a Warlock spell (class list includes Warlock)", () => {
    expect(ARMOR_OF_AGATHYS.classLists).toContain("Warlock");
  });

  it("is abjuration, action, self, no concentration", () => {
    expect(ARMOR_OF_AGATHYS.school).toBe("abjuration");
    expect(ARMOR_OF_AGATHYS.castingTime).toBe("action");
    expect(ARMOR_OF_AGATHYS.range).toBe("self");
    expect((ARMOR_OF_AGATHYS as any).concentration).toBeUndefined();
  });

  it("defines a temp_hp effect granting 5 temp HP at base slot level", () => {
    const tempHpEffect = ARMOR_OF_AGATHYS.effects.find((e) => e.type === "temp_hp");
    expect(tempHpEffect).toBeDefined();
    expect(tempHpEffect!.value).toBe(5);
    expect(tempHpEffect!.appliesTo).toBe("self");
    expect(tempHpEffect!.duration).toBe("rounds");
    expect(tempHpEffect!.roundsRemaining).toBe(600); // 1 hour
  });

  it("defines a retaliatory_damage effect for 5 cold damage", () => {
    const retaliation = ARMOR_OF_AGATHYS.effects.find((e) => e.type === "retaliatory_damage");
    expect(retaliation).toBeDefined();
    expect(retaliation!.value).toBe(5);
    expect(retaliation!.damageType).toBe("cold");
    expect(retaliation!.appliesTo).toBe("self");
    expect(retaliation!.duration).toBe("rounds");
    expect(retaliation!.roundsRemaining).toBe(600);
  });

  it("has VSM components", () => {
    expect(ARMOR_OF_AGATHYS.components.v).toBe(true);
    expect(ARMOR_OF_AGATHYS.components.s).toBe(true);
    expect(typeof ARMOR_OF_AGATHYS.components.m).toBe("string");
  });

  it("declares upcastFlatBonus: 5 on both temp_hp and retaliatory_damage effects", () => {
    const tempHp = ARMOR_OF_AGATHYS.effects.find((e) => e.type === "temp_hp");
    const retaliation = ARMOR_OF_AGATHYS.effects.find((e) => e.type === "retaliatory_damage");
    expect((tempHp as any).upcastFlatBonus).toBe(5);
    expect((retaliation as any).upcastFlatBonus).toBe(5);
  });
});
