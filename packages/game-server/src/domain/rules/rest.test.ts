import { describe, expect, it } from "vitest";
import { refreshClassResourcePools, spendHitDice, recoverHitDice, detectRestInterruption } from "./rest.js";
import { FixedDiceRoller } from "./dice-roller.js";

describe("rest resource refresh", () => {
  it("refreshes barbarian rage only on long rest", () => {
    const pools = [{ name: "rage", current: 0, max: 2 }];

    const shortRest = refreshClassResourcePools({
      classId: "barbarian",
      level: 1,
      rest: "short",
      pools,
    });
    expect(shortRest[0]!.current).toBe(0);

    const longRest = refreshClassResourcePools({
      classId: "barbarian",
      level: 1,
      rest: "long",
      pools,
    });
    expect(longRest[0]!.current).toBe(2);
    expect(longRest[0]!.max).toBe(2);
  });

  it("refreshes monk ki on short rest", () => {
    const pools = [{ name: "ki", current: 1, max: 5 }];
    const refreshed = refreshClassResourcePools({
      classId: "monk",
      level: 5,
      rest: "short",
      pools,
    });
    expect(refreshed[0]!.current).toBe(5);
    expect(refreshed[0]!.max).toBe(5);
  });

  it("refreshes warlock pact slots on short rest", () => {
    const pools = [{ name: "pactMagic", current: 0, max: 2 }];
    const refreshed = refreshClassResourcePools({
      classId: "warlock",
      level: 2,
      rest: "short",
      pools,
    });
    expect(refreshed[0]!.current).toBe(2);
    expect(refreshed[0]!.max).toBe(2);
  });

  it("refreshes bardic inspiration on long rest and on short rest at level 5+", () => {
    const pools = [{ name: "bardicInspiration", current: 0, max: 3 }];

    const shortRestAt4 = refreshClassResourcePools({
      classId: "bard",
      level: 4,
      rest: "short",
      pools,
      charismaModifier: 3,
    });
    expect(shortRestAt4[0]!.current).toBe(0);

    const shortRestAt5 = refreshClassResourcePools({
      classId: "bard",
      level: 5,
      rest: "short",
      pools,
      charismaModifier: 3,
    });
    expect(shortRestAt5[0]!.current).toBe(3);

    const longRest = refreshClassResourcePools({
      classId: "bard",
      level: 4,
      rest: "long",
      pools,
      charismaModifier: 3,
    });
    expect(longRest[0]!.current).toBe(3);
  });

  it("refreshes cleric channel divinity on short rest (2024 rules)", () => {
    const pools = [{ name: "channelDivinity", current: 0, max: 3 }];
    const refreshed = refreshClassResourcePools({
      classId: "cleric",
      level: 6,
      rest: "short",
      pools,
    });
    expect(refreshed[0]!.current).toBe(3);
    expect(refreshed[0]!.max).toBe(3);
  });

  it("refreshes druid wild shape on short rest", () => {
    const pools = [{ name: "wildShape", current: 0, max: 2 }];
    const refreshed = refreshClassResourcePools({
      classId: "druid",
      level: 2,
      rest: "short",
      pools,
    });
    expect(refreshed[0]!.current).toBe(2);
    expect(refreshed[0]!.max).toBe(2);
  });

  it("refreshes wizard arcane recovery only on long rest", () => {
    const pools = [{ name: "arcaneRecovery", current: 0, max: 1 }];

    const shortRest = refreshClassResourcePools({
      classId: "wizard",
      level: 3,
      rest: "short",
      pools,
    });
    expect(shortRest[0]!.current).toBe(0);

    const longRest = refreshClassResourcePools({
      classId: "wizard",
      level: 3,
      rest: "long",
      pools,
    });
    expect(longRest[0]!.current).toBe(1);
    expect(longRest[0]!.max).toBe(1);
  });

  it("refreshes paladin lay on hands only on long rest", () => {
    const pools = [{ name: "layOnHands", current: 3, max: 10 }];

    const shortRest = refreshClassResourcePools({
      classId: "paladin",
      level: 2,
      rest: "short",
      pools,
    });
    expect(shortRest[0]!.current).toBe(3);

    const longRest = refreshClassResourcePools({
      classId: "paladin",
      level: 2,
      rest: "long",
      pools,
    });
    expect(longRest[0]!.current).toBe(10);
    expect(longRest[0]!.max).toBe(10);
  });

  it("refreshes spell slot pools only on long rest", () => {
    const pools = [
      { name: "spellSlot_1", current: 1, max: 4 },
      { name: "spellSlot_2", current: 0, max: 3 },
      { name: "spellSlot_3", current: 0, max: 2 },
    ];

    const shortRest = refreshClassResourcePools({
      classId: "wizard",
      level: 5,
      rest: "short",
      pools,
    });
    expect(shortRest[0]!.current).toBe(1); // unchanged
    expect(shortRest[1]!.current).toBe(0); // unchanged
    expect(shortRest[2]!.current).toBe(0); // unchanged

    const longRest = refreshClassResourcePools({
      classId: "wizard",
      level: 5,
      rest: "long",
      pools,
    });
    expect(longRest[0]!.current).toBe(4);
    expect(longRest[0]!.max).toBe(4);
    expect(longRest[1]!.current).toBe(3);
    expect(longRest[2]!.current).toBe(2);
  });

  it("does not refresh spell slot pools on short rest (non-warlock)", () => {
    const pools = [
      { name: "spellSlot_1", current: 0, max: 4 },
      { name: "ki", current: 0, max: 5 },
    ];

    const refreshed = refreshClassResourcePools({
      classId: "monk",
      level: 5,
      rest: "short",
      pools,
    });
    expect(refreshed[0]!.current).toBe(0); // spell slot unchanged
    expect(refreshed[1]!.current).toBe(5); // ki refreshed
  });

  it("refreshes monk uncanny_metabolism on long rest only", () => {
    const pools = [{ name: "uncanny_metabolism", current: 0, max: 1 }];

    const shortRest = refreshClassResourcePools({
      classId: "monk",
      level: 3,
      rest: "short",
      pools,
    });
    expect(shortRest[0]!.current).toBe(0); // not refreshed on short rest

    const longRest = refreshClassResourcePools({
      classId: "monk",
      level: 3,
      rest: "long",
      pools,
    });
    expect(longRest[0]!.current).toBe(1);
    expect(longRest[0]!.max).toBe(1);
  });

  it("refreshes monk wholeness_of_body on long rest only (uses WIS mod)", () => {
    const pools = [{ name: "wholeness_of_body", current: 0, max: 3 }];

    const shortRest = refreshClassResourcePools({
      classId: "monk",
      level: 6,
      rest: "short",
      pools,
      wisdomModifier: 3,
    });
    expect(shortRest[0]!.current).toBe(0); // not refreshed on short rest

    const longRest = refreshClassResourcePools({
      classId: "monk",
      level: 6,
      rest: "long",
      pools,
      wisdomModifier: 3,
    });
    expect(longRest[0]!.current).toBe(3);
    expect(longRest[0]!.max).toBe(3);
  });

  it("monk wholeness_of_body computeMax enforces minimum 1 use when WIS mod is 0 or negative", () => {
    const pools = [{ name: "wholeness_of_body", current: 0, max: 1 }];

    const longRestZeroWis = refreshClassResourcePools({
      classId: "monk",
      level: 6,
      rest: "long",
      pools,
      wisdomModifier: 0,
    });
    expect(longRestZeroWis[0]!.current).toBe(1);
    expect(longRestZeroWis[0]!.max).toBe(1);
  });

  it("monk uncanny_metabolism not present below level 2", () => {
    const pools = [{ name: "uncanny_metabolism", current: 0, max: 1 }];

    const longRest = refreshClassResourcePools({
      classId: "monk",
      level: 1,
      rest: "long",
      pools,
    });
    // computeMax returns 0 at level 1, so pool refreshes to 0
    expect(longRest[0]!.current).toBe(0);
    expect(longRest[0]!.max).toBe(0);
  });
});

describe("spendHitDice", () => {
  it("spends hit dice and recovers HP (roll + CON modifier)", () => {
    const result = spendHitDice({
      hitDiceRemaining: 5,
      hitDie: 10,
      conModifier: 2,
      count: 2,
      currentHp: 20,
      maxHp: 44,
      diceRoller: new FixedDiceRoller(6), // each die rolls 6
    });

    // 2 dice × (6 + 2) = 16 HP healed
    expect(result.rolls).toEqual([6, 6]);
    expect(result.hpRecovered).toBe(16);
    expect(result.newHp).toBe(36);
    expect(result.hitDiceRemaining).toBe(3);
  });

  it("caps healing at maxHp", () => {
    const result = spendHitDice({
      hitDiceRemaining: 5,
      hitDie: 10,
      conModifier: 2,
      count: 3,
      currentHp: 40,
      maxHp: 44,
      diceRoller: new FixedDiceRoller(6),
    });

    expect(result.newHp).toBe(44);
    expect(result.hpRecovered).toBe(4);
    expect(result.hitDiceRemaining).toBe(2);
  });

  it("ensures minimum 1 HP per die even with negative CON modifier", () => {
    const result = spendHitDice({
      hitDiceRemaining: 3,
      hitDie: 6,
      conModifier: -3,
      count: 1,
      currentHp: 5,
      maxHp: 20,
      diceRoller: new FixedDiceRoller(1), // rolls 1, + (-3) = -2 → min 1
    });

    expect(result.rolls).toEqual([1]);
    expect(result.hpRecovered).toBe(1);
    expect(result.newHp).toBe(6);
    expect(result.hitDiceRemaining).toBe(2);
  });

  it("returns no change when no hit dice remaining", () => {
    const result = spendHitDice({
      hitDiceRemaining: 0,
      hitDie: 8,
      conModifier: 1,
      count: 2,
      currentHp: 10,
      maxHp: 30,
      diceRoller: new FixedDiceRoller(4),
    });

    expect(result.hpRecovered).toBe(0);
    expect(result.newHp).toBe(10);
    expect(result.hitDiceRemaining).toBe(0);
    expect(result.rolls).toEqual([]);
  });

  it("clamps count to available hit dice", () => {
    const result = spendHitDice({
      hitDiceRemaining: 1,
      hitDie: 12,
      conModifier: 3,
      count: 5,
      currentHp: 10,
      maxHp: 100,
      diceRoller: new FixedDiceRoller(8),
    });

    // Only 1 die available: 8 + 3 = 11
    expect(result.rolls).toEqual([8]);
    expect(result.hpRecovered).toBe(11);
    expect(result.hitDiceRemaining).toBe(0);
  });
});

describe("recoverHitDice", () => {
  it("recovers half total hit dice on long rest (rounded down)", () => {
    // Level 10: total=10, recover 5
    expect(recoverHitDice(5, 10)).toBe(10);
  });

  it("recovers minimum 1 hit die even at level 1", () => {
    // Level 1: total=1, half = 0 → min 1
    expect(recoverHitDice(0, 1)).toBe(1);
  });

  it("caps recovery at total hit dice", () => {
    // Already have 9/10, recover 5 → caps at 10
    expect(recoverHitDice(9, 10)).toBe(10);
  });

  it("does not exceed total when already full", () => {
    expect(recoverHitDice(10, 10)).toBe(10);
  });

  it("recovers 2 at level 5 (half of 5 = 2)", () => {
    expect(recoverHitDice(1, 5)).toBe(3);
  });
});

describe("detectRestInterruption", () => {
  it("detects combat as interruption for short rest", () => {
    const result = detectRestInterruption("short", [{ type: "CombatStarted" }]);
    expect(result.interrupted).toBe(true);
    expect(result.reason).toBe("combat");
  });

  it("detects combat as interruption for long rest", () => {
    const result = detectRestInterruption("long", [{ type: "CombatStarted" }]);
    expect(result.interrupted).toBe(true);
    expect(result.reason).toBe("combat");
  });

  it("detects damage taken as interruption for long rest", () => {
    const result = detectRestInterruption("long", [{ type: "DamageApplied" }]);
    expect(result.interrupted).toBe(true);
    expect(result.reason).toBe("damage");
  });

  it("does NOT treat damage as interruption for short rest", () => {
    const result = detectRestInterruption("short", [{ type: "DamageApplied" }]);
    expect(result.interrupted).toBe(false);
  });

  it("returns not interrupted when no relevant events", () => {
    const result = detectRestInterruption("long", []);
    expect(result.interrupted).toBe(false);
  });

  it("ignores non-interrupting events", () => {
    const result = detectRestInterruption("short", [{ type: "TurnAdvanced" }, { type: "NarrativeText" }]);
    expect(result.interrupted).toBe(false);
  });

  it("returns first interruption reason when multiple interrupting events exist", () => {
    const result = detectRestInterruption("long", [{ type: "DamageApplied" }, { type: "CombatStarted" }]);
    expect(result.interrupted).toBe(true);
    expect(result.reason).toBe("damage");
  });
});
