import { describe, it, expect } from "vitest";
import {
  tryMatchClassAction,
  matchAttackEnhancements,
  type ClassCombatTextProfile,
} from "./combat-text-profile.js";
import { MONK_COMBAT_TEXT_PROFILE } from "./monk.js";
import { FIGHTER_COMBAT_TEXT_PROFILE } from "./fighter.js";

const ALL_PROFILES: readonly ClassCombatTextProfile[] = [
  MONK_COMBAT_TEXT_PROFILE,
  FIGHTER_COMBAT_TEXT_PROFILE,
];

describe("tryMatchClassAction", () => {
  it("matches flurry of blows", () => {
    const result = tryMatchClassAction("flurry of blows", ALL_PROFILES);
    expect(result).toEqual({
      keyword: "flurry-of-blows",
      abilityId: "class:monk:flurry-of-blows",
      category: "bonusAction",
    });
  });

  it("matches 'flurry' alone", () => {
    const result = tryMatchClassAction("flurry", ALL_PROFILES);
    expect(result).not.toBeNull();
    expect(result!.keyword).toBe("flurry-of-blows");
  });

  it("matches patient defense", () => {
    const result = tryMatchClassAction("patient defense", ALL_PROFILES);
    expect(result).toEqual({
      keyword: "patient-defense",
      abilityId: "class:monk:patient-defense",
      category: "bonusAction",
    });
  });

  it("matches step of the wind dash before step of the wind", () => {
    const dash = tryMatchClassAction("step of the wind dash", ALL_PROFILES);
    expect(dash).not.toBeNull();
    expect(dash!.keyword).toBe("step-of-the-wind-dash");

    const plain = tryMatchClassAction("step of the wind", ALL_PROFILES);
    expect(plain).not.toBeNull();
    expect(plain!.keyword).toBe("step-of-the-wind");
  });

  it("matches martial arts / bonus unarmed", () => {
    expect(tryMatchClassAction("martial arts", ALL_PROFILES)?.keyword).toBe("martial-arts");
    expect(tryMatchClassAction("bonus unarmed", ALL_PROFILES)?.keyword).toBe("martial-arts");
    expect(tryMatchClassAction("bonus strike", ALL_PROFILES)?.keyword).toBe("martial-arts");
  });

  it("matches wholeness of body", () => {
    const result = tryMatchClassAction("wholeness of body", ALL_PROFILES);
    expect(result?.keyword).toBe("wholeness-of-body");
    expect(result?.category).toBe("bonusAction");
  });

  it("matches action surge as classAction", () => {
    const result = tryMatchClassAction("action surge", ALL_PROFILES);
    expect(result).toEqual({
      keyword: "action-surge",
      abilityId: "class:fighter:action-surge",
      category: "classAction",
    });
  });

  it("matches 'use action surge'", () => {
    const result = tryMatchClassAction("use action surge", ALL_PROFILES);
    expect(result?.keyword).toBe("action-surge");
  });

  it("matches second wind as bonusAction", () => {
    const result = tryMatchClassAction("second wind", ALL_PROFILES);
    expect(result).toEqual({
      keyword: "second-wind",
      abilityId: "class:fighter:second-wind",
      category: "bonusAction",
    });
  });

  it("returns null for unrecognized text", () => {
    expect(tryMatchClassAction("attack goblin", ALL_PROFILES)).toBeNull();
    expect(tryMatchClassAction("move to (5,5)", ALL_PROFILES)).toBeNull();
    expect(tryMatchClassAction("dodge", ALL_PROFILES)).toBeNull();
  });

  it("returns null for empty profiles", () => {
    expect(tryMatchClassAction("flurry of blows", [])).toBeNull();
  });
});

describe("matchAttackEnhancements", () => {
  const kiPool = { name: "ki", current: 3 };

  it("matches stunning strike for melee attack with ki", () => {
    const result = matchAttackEnhancements(
      "attack goblin with stunning strike",
      "melee", "monk", 5, {}, [kiPool], ALL_PROFILES,
    );
    expect(result).toEqual(["stunning-strike"]);
  });

  it("matches 'stun' keyword", () => {
    const result = matchAttackEnhancements(
      "unarmed strike stun",
      "melee", "monk", 5, {}, [kiPool], ALL_PROFILES,
    );
    expect(result).toEqual(["stunning-strike"]);
  });

  it("rejects stunning strike for ranged attacks", () => {
    const result = matchAttackEnhancements(
      "attack goblin with stunning strike",
      "ranged", "monk", 5, {}, [kiPool], ALL_PROFILES,
    );
    expect(result).toEqual([]);
  });

  it("rejects stunning strike below level 5", () => {
    const result = matchAttackEnhancements(
      "attack goblin with stunning strike",
      "melee", "monk", 4, {}, [kiPool], ALL_PROFILES,
    );
    expect(result).toEqual([]);
  });

  it("rejects stunning strike when already used this turn", () => {
    const result = matchAttackEnhancements(
      "attack goblin with stunning strike",
      "melee", "monk", 5, { stunningStrikeUsedThisTurn: true }, [kiPool], ALL_PROFILES,
    );
    expect(result).toEqual([]);
  });

  it("rejects stunning strike with no ki", () => {
    const result = matchAttackEnhancements(
      "attack goblin with stunning strike",
      "melee", "monk", 5, {}, [{ name: "ki", current: 0 }], ALL_PROFILES,
    );
    expect(result).toEqual([]);
  });

  it("rejects stunning strike for non-monk", () => {
    const result = matchAttackEnhancements(
      "attack goblin with stunning strike",
      "melee", "fighter", 5, {}, [kiPool], ALL_PROFILES,
    );
    expect(result).toEqual([]);
  });

  it("returns empty for unrecognized text", () => {
    const result = matchAttackEnhancements(
      "attack goblin",
      "melee", "monk", 5, {}, [kiPool], ALL_PROFILES,
    );
    expect(result).toEqual([]);
  });

  it("returns empty for empty profiles", () => {
    const result = matchAttackEnhancements(
      "attack goblin with stunning strike",
      "melee", "monk", 5, {}, [kiPool], [],
    );
    expect(result).toEqual([]);
  });
});
