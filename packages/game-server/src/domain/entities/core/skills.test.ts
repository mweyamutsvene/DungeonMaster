import { describe, expect, it } from "vitest";

import { getGoverningAbility } from "./skills.js";

describe("Skills", () => {
  it("maps skills to their governing ability", () => {
    expect(getGoverningAbility("athletics")).toBe("strength");
    expect(getGoverningAbility("stealth")).toBe("dexterity");
    expect(getGoverningAbility("arcana")).toBe("intelligence");
    expect(getGoverningAbility("perception")).toBe("wisdom");
    expect(getGoverningAbility("persuasion")).toBe("charisma");
  });
});
