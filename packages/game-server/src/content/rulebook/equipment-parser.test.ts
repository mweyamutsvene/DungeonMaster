import { describe, expect, it } from "vitest";
import { parseEquipmentMarkdown } from "./equipment-parser.js";

describe("parseEquipmentMarkdown", () => {
  it("parses weapon groups and armor categories", () => {
    const md = `# Equipment\n\n##### Weapons\n\n| Name | Damage | Properties | Mastery | Weight | Cost |\n| --- | --- | --- | --- | --- | --- |\n| *Simple Melee Weapons* |  |  |  |  |  |\n| Dagger | 1d4 Piercing | Finesse, Light | Nick | 1 lb. | 2 GP |\n| *Martial Ranged Weapons* |  |  |  |  |  |\n| Longbow | 1d8 Piercing | Ammunition (Range 150/600; Arrow), Heavy | Slow | 2 lb. | 50 GP |\n\n##### Armor\n\n| Armor | Armor Class (AC) | Strength | Stealth | Weight | Cost |\n| --- | --- | --- | --- | --- | --- |\n| *Light Armor (1 Minute to Don or Doff)* |  |  |  |  |  |\n| Leather Armor | 11 + Dex modifier | — | — | 10 lb. | 10 GP |\n| *Heavy Armor (10 Minutes to Don and 5 Minutes to Doff)* |  |  |  |  |  |\n| Chain Mail | 16 | Str 13 | Disadvantage | 55 lb. | 75 GP |\n| *Shield (Utilize Action to Don or Doff)* |  |  |  |  |  |\n| Shield | +2 | — | — | 6 lb. | 10 GP |`;

    const parsed = parseEquipmentMarkdown(md);
    expect(parsed.weapons.length).toBe(2);
    expect(parsed.weapons[0]!.category).toBe("simple");
    expect(parsed.weapons[0]!.kind).toBe("melee");
    expect(parsed.weapons[0]!.cost).toEqual({ amount: 2, unit: "gp" });

    expect(parsed.armor.length).toBe(3);
    expect(parsed.armor[0]!.category).toBe("light");
    expect(parsed.armor[1]!.category).toBe("heavy");
    expect(parsed.armor[2]!.category).toBe("shield");
  });
});
